"use server";

import { revalidatePath } from "next/cache";
import { requireContext, requirePermission } from "@/lib/auth/guard";
import { attempt, bool, dateOf, int, moneyOf, optInt, optStr, str, type ActionState } from "@/lib/actions/support";
import {
  archiveDocument,
  deleteDocument,
  extractDocument,
  getDocument,
  linkDocument,
  suggestCategory,
  updateExtractedFields,
  uploadDocument,
  type ExtractedFields,
} from "@/lib/services/documents";
import { createExpense } from "@/lib/services/purchases";
import { createBill } from "@/lib/services/purchases";
import { createInvoice } from "@/lib/services/sales";
import { todayISO } from "@/lib/dates";

function revalidateDocuments(id?: number) {
  revalidatePath("/documents");
  revalidatePath("/documents/scanner");
  if (id) revalidatePath(`/documents/${id}`);
  revalidatePath("/dashboard");
}

export async function uploadDocumentAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(async () => {
    requirePermission(context, "create");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to upload.");
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = uploadDocument(
      {
        companyId: context.company.id,
        filename: file.name,
        mime: file.type || "application/octet-stream",
        buffer,
        kind: (optStr(form, "kind") as "invoice" | "receipt" | "statement" | "contract" | "other") ?? undefined,
        notes: optStr(form, "notes"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    const suggestion = suggestCategory(context.company.id, JSON.stringify(result.fields));
    revalidateDocuments(result.documentId);
    return { documentId: result.documentId, fields: result.fields, suggestion };
  });
}

export async function reextractDocumentAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(async () => {
    requirePermission(context, "edit");
    const document = getDocument(context.company.id, int(form, "documentId"));
    if (!document) throw new Error("Document not found");
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose the file again to re-run extraction.");
    const buffer = Buffer.from(await file.arrayBuffer());
    const fields = extractDocument({ buffer, filename: file.name, mime: file.type });
    revalidateDocuments(Number(document.document.id));
    return fields;
  });
}

export async function updateExtractionAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "edit");
    const documentId = int(form, "documentId");
    const fields: Partial<ExtractedFields> = {
      documentNumber: optStr(form, "documentNumber") ?? null,
      documentDate: optStr(form, "documentDate") ?? null,
      dueDate: optStr(form, "dueDate") ?? null,
      companyName: optStr(form, "companyName") ?? null,
      taxId: optStr(form, "taxId") ?? null,
      counterparty: optStr(form, "counterparty") ?? null,
      subtotal: optStr(form, "subtotal") ? moneyOf(form, "subtotal", context.currency) : null,
      vatAmount: optStr(form, "vatAmount") ? moneyOf(form, "vatAmount", context.currency) : null,
      total: optStr(form, "total") ? moneyOf(form, "total", context.currency) : null,
      currency: str(form, "currency", context.currency),
    };
    updateExtractedFields(context.company.id, documentId, fields, { userId: context.user.id, userName: context.user.name });
    revalidateDocuments(documentId);
    return documentId;
  });
}

/** Turn a reviewed document into a ledger transaction — only on explicit confirmation. */
export async function postDocumentAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "create");
    const documentId = int(form, "documentId");
    const document = getDocument(context.company.id, documentId);
    if (!document) throw new Error("Document not found");
    const extracted = (document.extracted ?? {}) as ExtractedFields;
    const kind = str(form, "targetType", "expense");
    const total = optStr(form, "amount") ? moneyOf(form, "amount", context.currency) : (extracted.total ?? 0);
    const vat = optStr(form, "vatAmount") ? moneyOf(form, "vatAmount", context.currency) : (extracted.vatAmount ?? 0);
    const date = dateOf(form, "date", extracted.documentDate ?? todayISO());
    const documentName = String(document.document.name ?? "Document");
    if (total <= 0) throw new Error("Enter the document total before posting.");

    if (kind === "expense") {
      const result = createExpense(
        {
          companyId: context.company.id,
          date,
          categoryId: optInt(form, "categoryId"),
          paymentAccountId: optInt(form, "paymentAccountId"),
          amount: Math.max(0, total - vat),
          taxAmount: vat,
          currency: extracted.currency || context.currency,
          description: extracted.counterparty ?? documentName,
          reference: extracted.documentNumber ?? undefined,
          isPaid: bool(form, "isPaid", true),
          sourceDocumentId: documentId,
          aiSuggested: true,
        },
        { userId: context.user.id, userName: context.user.name },
      );
      linkDocument(context.company.id, documentId, "expense", result.expenseId, "approved");
      revalidateDocuments(documentId);
      revalidatePath("/purchases/expenses");
      return result.expenseId;
    }

    if (kind === "bill") {
      const supplierId = optInt(form, "contactId");
      if (!supplierId) throw new Error("Choose the supplier for this bill.");
      const billId = createBill(
        {
          companyId: context.company.id,
          contactId: supplierId,
          issueDate: date,
          dueDate: dateOf(form, "dueDate", date),
          currency: extracted.currency || context.currency,
          lines: [
            {
              description: extracted.counterparty ?? documentName,
              qtyMilli: 1000,
              unitPrice: Math.max(0, total - vat),
              taxRateBp: total - vat > 0 ? Math.round((vat / Math.max(1, total - vat)) * 10_000) : 0,
            },
          ],
          postImmediately: true,
        },
        { userId: context.user.id, userName: context.user.name },
      );
      linkDocument(context.company.id, documentId, "bill", billId, "approved");
      revalidateDocuments(documentId);
      revalidatePath("/purchases/bills");
      return billId;
    }

    const customerId = optInt(form, "contactId");
    if (!customerId) throw new Error("Choose the customer for this invoice.");
    const invoiceId = createInvoice(
      {
        companyId: context.company.id,
        contactId: customerId,
        issueDate: date,
        dueDate: dateOf(form, "dueDate", date),
        currency: extracted.currency || context.currency,
        lines: [
          {
            description: extracted.counterparty ?? documentName,
            qtyMilli: 1000,
            unitPrice: Math.max(0, total - vat),
            taxRateBp: total - vat > 0 ? Math.round((vat / Math.max(1, total - vat)) * 10_000) : 0,
          },
        ],
      },
      { userId: context.user.id, userName: context.user.name },
    );
    linkDocument(context.company.id, documentId, "invoice", invoiceId, "approved");
    revalidateDocuments(documentId);
    revalidatePath("/sales/invoices");
    return invoiceId;
  });
}

export async function archiveDocumentAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "edit");
    const id = int(form, "documentId");
    archiveDocument(context.company.id, id, { userId: context.user.id, userName: context.user.name });
    revalidateDocuments(id);
    return true;
  });
}

export async function deleteDocumentAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "delete");
    const id = int(form, "documentId");
    deleteDocument(context.company.id, id, { userId: context.user.id, userName: context.user.name });
    revalidateDocuments(id);
    return true;
  });
}

export type { ActionState };
