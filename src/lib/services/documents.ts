/**
 * Document AI — ingestion, extraction and review.
 *
 * Honest scope: BUXAI automatically reads documents that carry a text layer
 * (PDF, XLSX, CSV, TXT) and applies field heuristics to invoices, receipts and
 * bank statements. Image files (JPG/PNG scans) are stored and attached, but the
 * fields are not guessed from pixels — they are marked as requiring manual
 * review. Nothing is ever posted to the ledger without explicit confirmation.
 */
import fs from "node:fs";
import path from "node:path";
import { all, insert, nowISO, one, run, tx } from "@/lib/db";
import { ValidationError } from "@/lib/accounting/errors";
import { DEFAULT_CATEGORIES } from "@/lib/accounting/coa";
import { parseDateCell, parseStatementFile, parseXlsx, extractPdfText } from "./statement-parse";
import { recordAudit } from "./company";

export type Ctx = { userId?: number | null; userName?: string | null };

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/csv",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export type ExtractedFields = {
  documentNumber: string | null;
  documentDate: string | null;
  dueDate: string | null;
  companyName: string | null;
  taxId: string | null;
  counterparty: string | null;
  subtotal: number | null;
  vatAmount: number | null;
  total: number | null;
  currency: string;
  paymentInfo: string | null;
  items: { description: string; qty: number | null; amount: number | null }[];
  confidenceBp: number;
  engine: string;
  notes: string[];
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/jpg"];

function moneyToMinor(value: string): number | null {
  const cleaned = value.replace(/\u00a0/g, "").replace(/\s/g, "").replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (lastComma > -1) {
    normalized = cleaned.length - lastComma - 1 === 3 ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function extractFieldsFromText(text: string, isStatement = false): ExtractedFields {
  const notes: string[] = [];
  const documentNumber = firstMatch(text, [
    /(?:invoice|hisob[- ]?faktura|сч[её]т[- ]?фактура|№|no\.?|number)\s*[:#№]?\s*([A-ZА-Я0-9][A-ZА-Я0-9\-/]{2,20})/i,
  ]);
  const dateRaw = firstMatch(text, [/(?:date|sana|дата)\s*[:#]?\s*([0-9]{1,2}[.\-/][0-9]{1,2}[.\-/][0-9]{2,4})/i]);
  const documentDate = dateRaw ? parseDateCell(dateRaw) : null;
  const dueRaw = firstMatch(text, [/(?:due date|to'lov muddati|срок оплаты|оплатить до)\s*[:#]?\s*([0-9]{1,2}[.\-/][0-9]{1,2}[.\-/][0-9]{2,4})/i]);
  const dueDate = dueRaw ? parseDateCell(dueRaw) : null;
  const taxId = firstMatch(text, [/(?:stir|inn|inp|tin|tax id|ИНН|СТИР)\s*[:#№]?\s*(\d{9,12})/i]);
  const companyName = firstMatch(text, [/(?:seller|supplier|yetkazib beruvchi|поставщик|from)\s*[:#]?\s*([^\n]{3,60})/i]);

  const totalCandidates = [
    /(?:total|jami|итого|amount due|сумма к оплате|to'lov summasi)\s*[:#]?\s*([\d\s.,]{3,})/i,
    /(?:umumiy summa|всего к оплате)\s*[:#]?\s*([\d\s.,]{3,})/i,
  ];
  const vatCandidates = [/(?:vat|qqs|ндс)\s*(?:12%?)?\s*[:#]?\s*([\d\s.,]{3,})/i];
  const subtotalCandidates = [/(?:subtotal|oralik jami|промежуточн[а-я]*\s*(?:итог)?|без ндс|without vat)\s*[:#]?\s*([\d\s.,]{3,})/i];

  const totalRaw = firstMatch(text, totalCandidates);
  const vatRaw = firstMatch(text, vatCandidates);
  const subtotalRaw = firstMatch(text, subtotalCandidates);

  const total = totalRaw ? moneyToMinor(totalRaw) : null;
  const vatAmount = vatRaw ? moneyToMinor(vatRaw) : null;
  let subtotal = subtotalRaw ? moneyToMinor(subtotalRaw) : null;
  if (!subtotal && total !== null && vatAmount !== null) subtotal = total - vatAmount;

  const currency = /usd|доллар|\$/i.test(text) ? "USD" : /eur|евро|€/i.test(text) ? "EUR" : /rub|руб|₽/i.test(text) ? "RUB" : "UZS";
  const paymentInfo = firstMatch(text, [/(?:account|hisob raqam|р\/с|сч[её]т)\s*[:#]?\s*([0-9]{16,20})/i]);

  let confidence = 2000;
  if (documentDate) confidence += 1500;
  if (total !== null) confidence += 2500;
  if (taxId) confidence += 1000;
  if (documentNumber) confidence += 1000;
  if (vatAmount !== null) confidence += 500;
  if (subtotal !== null) confidence += 500;
  if (isStatement) confidence = Math.max(confidence - 500, 2000);

  if (total === null) notes.push("Total amount was not found in the text — enter it manually.");
  if (vatAmount === null) notes.push("VAT amount was not found — check the tax treatment before posting.");
  if (!documentDate) notes.push("Document date was not found — enter it manually.");

  return {
    documentNumber,
    documentDate,
    dueDate,
    companyName,
    taxId,
    counterparty: companyName,
    subtotal,
    vatAmount,
    total,
    currency,
    paymentInfo,
    items: [],
    confidenceBp: Math.min(confidence, 9500),
    engine: isStatement ? "statement-parser" : "text-extractor",
    notes,
  };
}

function extractFromDelimited(buffer: Buffer): { fields: ExtractedFields; text: string } {
  const text = buffer.toString("utf8");
  const fields = extractFieldsFromText(text);
  const rows = parseXlsx(Buffer.alloc(0));
  void rows;
  return { fields, text };
}

export function extractDocument(file: { buffer: Buffer; filename: string; mime: string }): ExtractedFields {
  const lower = file.filename.toLowerCase();

  if (IMAGE_TYPES.includes(file.mime) || /\.(jpe?g|png)$/i.test(lower)) {
    return {
      documentNumber: null,
      documentDate: null,
      dueDate: null,
      companyName: null,
      taxId: null,
      counterparty: null,
      subtotal: null,
      vatAmount: null,
      total: null,
      currency: "UZS",
      paymentInfo: null,
      items: [],
      confidenceBp: 0,
      engine: "manual-review",
      notes: [
        "This is an image (scan or photo). BUXAI does not read amounts from images — no OCR engine is configured in this deployment, so the fields are not guessed.",
        "Enter the amounts manually and confirm: the file stays attached to the transaction as the source document.",
      ],
    };
  }

  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    const rows = parseXlsx(file.buffer);
    if (rows.length) {
      const text = rows.map((row) => row.join(" ")).join("\n");
      const statement = /bank|bank statement|ko'chirma|выписка/i.test(text);
      const fields = extractFieldsFromText(text, statement);
      fields.engine = "xlsx-reader";
      return fields;
    }
    return { ...extractFieldsFromText(""), engine: "xlsx-reader", notes: ["The workbook could not be read — enter the fields manually."] };
  }

  if (lower.endsWith(".pdf")) {
    const text = extractPdfText(file.buffer);
    if (!text.trim()) {
      return {
        documentNumber: null,
        documentDate: null,
        dueDate: null,
        companyName: null,
        taxId: null,
        counterparty: null,
        subtotal: null,
        vatAmount: null,
        total: null,
        currency: "UZS",
        paymentInfo: null,
        items: [],
        confidenceBp: 0,
        engine: "manual-review",
        notes: [
          "This PDF has no text layer (it is a scan). Fields are not guessed from images — enter them manually.",
          "The original file remains attached as the supporting document.",
        ],
      };
    }
    const statement = /bank|ko'chirma|выписка|hisobvaraq/i.test(text);
    const fields = extractFieldsFromText(text, statement);
    fields.engine = "pdf-text-reader";
    return fields;
  }

  if (lower.endsWith(".csv") || lower.endsWith(".txt") || file.mime === "text/csv" || file.mime === "text/plain") {
    const { fields } = extractFromDelimited(file.buffer);
    fields.engine = "csv-reader";
    return fields;
  }

  return {
    documentNumber: null,
    documentDate: null,
    dueDate: null,
    companyName: null,
    taxId: null,
    counterparty: null,
    subtotal: null,
    vatAmount: null,
    total: null,
    currency: "UZS",
    paymentInfo: null,
    items: [],
    confidenceBp: 0,
    engine: "unsupported",
    notes: [
      "BUXAI cannot read this file type automatically. The file is stored as a supporting document — enter the transaction manually.",
      "Supported for automatic reading: PDF with a text layer, XLSX, CSV, TXT.",
    ],
  };
}

export function storeUpload(companyId: number, filename: string, buffer: Buffer): string {
  const dir = path.join(process.cwd(), "data", "uploads", String(companyId));
  fs.mkdirSync(dir, { recursive: true });
  const safeName = `${Date.now()}-${filename.replace(/[^\w.\-]+/g, "_")}`;
  fs.writeFileSync(path.join(dir, safeName), buffer);
  return path.join("data", "uploads", String(companyId), safeName);
}

export type UploadInput = {
  companyId: number;
  filename: string;
  mime: string;
  buffer: Buffer;
  kind?: "invoice" | "receipt" | "statement" | "contract" | "other";
  notes?: string;
};

export function uploadDocument(input: UploadInput, ctx: Ctx = {}): { documentId: number; fields: ExtractedFields; status: string } {
  return tx(() => {
    if (input.buffer.length > MAX_UPLOAD_BYTES) throw new ValidationError("FILE_TOO_LARGE", "File is larger than 12 MB");
    const storagePath = storeUpload(input.companyId, input.filename, input.buffer);
    const fields = extractDocument({ buffer: input.buffer, filename: input.filename, mime: input.mime });
    const guessedKind =
      input.kind ??
      (/statement|ko'chirma|выписк/i.test(input.filename) ? "statement" : /receipt|kvitans|чек/i.test(input.filename) ? "receipt" : /contract|shartnoma|договор/i.test(input.filename) ? "contract" : "other");
    const status = fields.confidenceBp >= 5000 ? "needs_review" : "needs_review";

    const documentId = insert(
      `INSERT INTO documents (company_id, name, kind, mime, size, storage_path, status, extracted, extraction_engine,
        extraction_confidence_bp, detected_company, detected_tax_id, notes, uploaded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.companyId,
        input.filename,
        guessedKind,
        input.mime,
        input.buffer.length,
        storagePath,
        status,
        JSON.stringify(fields),
        fields.engine,
        fields.confidenceBp,
        fields.companyName,
        fields.taxId,
        input.notes ?? null,
        ctx.userId ?? null,
        nowISO(),
        nowISO(),
      ],
    );

    recordAudit({
      companyId: input.companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "upload",
      entityType: "document",
      entityId: documentId,
      summary: `Uploaded ${input.filename} (${fields.engine}, confidence ${fields.confidenceBp / 100}%)`,
      after: { kind: guessedKind, engine: fields.engine },
    });

    return { documentId, fields, status };
  });
}

/** Suggest a category/account for an expense based on the extracted text. */
export function suggestCategory(companyId: number, text: string): { categoryId: number | null; categoryName: string | null; reason: string; confidence: number } {
  const haystack = text.toLowerCase();
  const categories = all<{ id: number; name: string; account_id: number | null }>(
    "SELECT id, name, account_id FROM categories WHERE company_id = ? AND kind = 'expense'",
    [companyId],
  );
  for (const seed of DEFAULT_CATEGORIES) {
    if (!seed.keywords?.length) continue;
    const hit = seed.keywords.find((keyword) => haystack.includes(keyword.toLowerCase()));
    if (!hit) continue;
    const match = categories.find((category) => category.name.toLowerCase() === seed.name.toLowerCase());
    if (match) {
      return {
        categoryId: match.id,
        categoryName: match.name,
        reason: `The document text contains "${hit}", which maps to ${seed.name}.`,
        confidence: 7000,
      };
    }
  }
  const fallback = categories.find((category) => /other|boshqa|проч/i.test(category.name)) ?? categories[0] ?? null;
  return {
    categoryId: fallback?.id ?? null,
    categoryName: fallback?.name ?? null,
    reason: "No keyword matched — BUXAI suggests the general expense category. Confirm before posting.",
    confidence: 3000,
  };
}

export function listDocuments(
  companyId: number,
  filters: { kind?: string; status?: string; search?: string; limit?: number } = {},
): Record<string, unknown>[] {
  const conditions = ["d.company_id = ?"];
  const params: unknown[] = [companyId];
  if (filters.kind && filters.kind !== "all") {
    conditions.push("d.kind = ?");
    params.push(filters.kind);
  }
  if (filters.status && filters.status !== "all") {
    conditions.push("d.status = ?");
    params.push(filters.status);
  }
  if (filters.search) {
    conditions.push("(d.name LIKE ? OR d.detected_company LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  params.push(filters.limit ?? 200);
  return all(
    `SELECT d.id, d.name, d.kind, d.mime, d.size, d.status, d.extraction_engine AS engine,
            d.extraction_confidence_bp AS confidenceBp, d.detected_company AS detectedCompany,
            d.detected_tax_id AS detectedTaxId, d.linked_type AS linkedType, d.linked_id AS linkedId,
            d.uploaded_by AS uploadedBy, u.name AS uploadedByName, d.created_at AS createdAt, d.notes,
            d.extracted AS extractedJson
       FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE ${conditions.join(" AND ")}
      ORDER BY d.id DESC LIMIT ?`,
    params,
  );
}

export function getDocument(companyId: number, documentId: number) {
  const document = one<Record<string, unknown>>("SELECT * FROM documents WHERE id = ? AND company_id = ?", [documentId, companyId]);
  if (!document) return undefined;
  const extracted = typeof document.extracted === "string" ? (JSON.parse(document.extracted as string) as ExtractedFields) : null;
  return { document, extracted };
}

export function updateExtractedFields(companyId: number, documentId: number, fields: Partial<ExtractedFields>, ctx: Ctx = {}): void {
  const current = one<{ extracted: string | null }>("SELECT extracted FROM documents WHERE id = ? AND company_id = ?", [documentId, companyId]);
  if (!current) throw new ValidationError("NOT_FOUND", "Document not found");
  const merged: ExtractedFields = {
    ...(current.extracted ? (JSON.parse(current.extracted) as ExtractedFields) : ({} as ExtractedFields)),
    ...fields,
    engine: "manual-review",
    confidenceBp: 10_000,
    notes: ["Reviewed and corrected by the user."],
  };
  run("UPDATE documents SET extracted = ?, status = 'needs_review', extraction_engine = ?, extraction_confidence_bp = 10000, updated_at = ? WHERE id = ? AND company_id = ?", [
    JSON.stringify(merged),
    merged.engine,
    nowISO(),
    documentId,
    companyId,
  ]);
  recordAudit({
    companyId,
    userId: ctx.userId,
    userName: ctx.userName,
    action: "review",
    entityType: "document",
    entityId: documentId,
    summary: "Reviewed and corrected extracted document fields",
    after: fields,
  });
}

export function linkDocument(companyId: number, documentId: number, linkedType: string, linkedId: number, status = "approved"): void {
  run("UPDATE documents SET linked_type = ?, linked_id = ?, status = ?, updated_at = ? WHERE id = ? AND company_id = ?", [
    linkedType,
    linkedId,
    status,
    nowISO(),
    documentId,
    companyId,
  ]);
}

export function archiveDocument(companyId: number, documentId: number, ctx: Ctx = {}): void {
  run("UPDATE documents SET status = 'archived', updated_at = ? WHERE id = ? AND company_id = ?", [nowISO(), documentId, companyId]);
  recordAudit({
    companyId,
    userId: ctx.userId,
    userName: ctx.userName,
    action: "archive",
    entityType: "document",
    entityId: documentId,
    summary: "Document archived",
  });
}

export function deleteDocument(companyId: number, documentId: number, ctx: Ctx = {}): void {
  return tx(() => {
    const document = one<{ storage_path: string | null; linked_type: string | null }>(
      "SELECT storage_path, linked_type FROM documents WHERE id = ? AND company_id = ?",
      [documentId, companyId],
    );
    if (!document) throw new ValidationError("NOT_FOUND", "Document not found");
    if (document.linked_type) {
      throw new ValidationError("LINKED", "This document is attached to a posted transaction — archive it instead of deleting.");
    }
    if (document.storage_path) {
      const absolute = path.join(process.cwd(), document.storage_path);
      if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
    }
    run("DELETE FROM documents WHERE id = ? AND company_id = ?", [documentId, companyId]);
    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "delete",
      entityType: "document",
      entityId: documentId,
      summary: "Deleted an unreviewed document",
    });
  });
}

export function documentsSummary(companyId: number) {
  return {
    total: one<{ count: number }>("SELECT COUNT(*) AS count FROM documents WHERE company_id = ?", [companyId])?.count ?? 0,
    needsReview:
      one<{ count: number }>("SELECT COUNT(*) AS count FROM documents WHERE company_id = ? AND status = 'needs_review'", [companyId])?.count ?? 0,
    approved: one<{ count: number }>("SELECT COUNT(*) AS count FROM documents WHERE company_id = ? AND status = 'approved'", [companyId])?.count ?? 0,
    archived: one<{ count: number }>("SELECT COUNT(*) AS count FROM documents WHERE company_id = ? AND status = 'archived'", [companyId])?.count ?? 0,
  };
}
