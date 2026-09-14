/**
 * Bank statement parsing.
 *
 * Supports the formats businesses actually receive:
 *   • CSV / TXT with comma, semicolon or tab delimiters (any column order)
 *   • XLSX (read natively — no external service, no upload to third parties)
 *   • PDF with a text layer (best effort)
 *   • Pasted text
 *
 * The parser reports what it could and could not understand instead of
 * inventing rows; anything ambiguous is returned flagged for review.
 */
import zlib from "node:zlib";

export type ParsedStatementRow = {
  date: string;
  description: string;
  counterparty: string | null;
  reference: string | null;
  direction: "in" | "out";
  amount: number; // minor units
  raw: string;
  warnings: string[];
};

export type ParseResult = {
  format: "csv" | "xlsx" | "pdf" | "text";
  detectedBank: string | null;
  rows: ParsedStatementRow[];
  skipped: number;
  warnings: string[];
  columns: Record<string, string | null>;
};

const BANK_SIGNATURES: { name: string; patterns: string[] }[] = [
  { name: "Kapitalbank", patterns: ["kapitalbank", "kapital bank", "капиталбанк"] },
  { name: "NBU (National Bank of Uzbekistan)", patterns: ["nbu", "milliy bank", "национальный банк", "uzbekistan national bank"] },
  { name: "Ipak Yo'li Bank", patterns: ["ipak yo", "ipak yuli", "ипак йули", "ipak yo'li"] },
  { name: "Hamkorbank", patterns: ["hamkorbank", "хамкорбанк"] },
  { name: "Asakabank", patterns: ["asakabank", "асакабанк"] },
  { name: "Agrobank", patterns: ["agrobank", "агробанк"] },
  { name: "Uzpromstroybank (SQB)", patterns: ["sqb", "uzpromstroy", "узпромстройбанк"] },
  { name: "Trastbank", patterns: ["trastbank", "трастбанк"] },
  { name: "Xalq banki", patterns: ["xalq bank", "хalq bank", "народный банк"] },
  { name: "Infinbank", patterns: ["infinbank", "инфинбанк"] },
  { name: "Anorbank", patterns: ["anorbank", "анорбанк"] },
  { name: "TBC Bank UZ", patterns: ["tbc bank", "tbc uz"] },
  { name: "Davr Bank", patterns: ["davr bank", "давр банк"] },
  { name: "Orient Finans", patterns: ["orient finans", "ориент финанс"] },
  { name: "Ipoteka Bank", patterns: ["ipoteka", "ипотека банк"] },
  { name: "Ziraat Bank Uzbekistan", patterns: ["ziraat"] },
];

export function detectBank(text: string): string | null {
  const haystack = text.toLowerCase();
  for (const bank of BANK_SIGNATURES) {
    if (bank.patterns.some((pattern) => haystack.includes(pattern))) return bank.name;
  }
  return null;
}

const HEADER_MAP: { field: keyof ColumnMap; patterns: string[] }[] = [
  { field: "date", patterns: ["date", "sana", "дата", "transaction date", "operation date", "tranzaksiya sanasi"] },
  { field: "valueDate", patterns: ["value date", "valyuta sanasi", "дата валютирования"] },
  { field: "description", patterns: ["description", "izoh", "назначение", "purpose", "details", "tavsif", "naznachenie", "comment"] },
  { field: "counterparty", patterns: ["counterparty", "kontragent", "контрагент", "payer", "плательщик", "receiver", "получатель", "tashkilot", "name"] },
  { field: "reference", patterns: ["reference", "ref", "doc", "hujjat", "документ", "number", "№", "document"] },
  { field: "debit", patterns: ["debit", "debet", "дебет", "chiqim", "расход", "out", "spisanie"] },
  { field: "credit", patterns: ["credit", "kredit", "кредит", "kirim", "приход", "in", "postuplenie", "zachislenie"] },
  { field: "amount", patterns: ["amount", "summa", "сумма", "oborot", "total", "sum"] },
  { field: "currency", patterns: ["currency", "valyuta", "валюта"] },
];

type ColumnMap = {
  date: number | null;
  valueDate: number | null;
  description: number | null;
  counterparty: number | null;
  reference: number | null;
  debit: number | null;
  credit: number | null;
  amount: number | null;
  currency: number | null;
};

function detectColumns(header: string[]): ColumnMap {
  const map: ColumnMap = {
    date: null,
    valueDate: null,
    description: null,
    counterparty: null,
    reference: null,
    debit: null,
    credit: null,
    amount: null,
    currency: null,
  };
  const normalized = header.map((cell) => cell.toLowerCase().trim());
  for (const { field, patterns } of HEADER_MAP) {
    const index = normalized.findIndex((cell, position) => {
      if (Object.values(map).includes(position) && field !== "date") return false;
      return patterns.some((pattern) => cell.includes(pattern));
    });
    if (index >= 0) map[field] = index;
  }
  return map;
}

export function splitDelimited(text: string): { rows: string[][]; delimiter: string } {
  const firstLines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 5);
  const candidates = [";", "\t", ","];
  let bestDelimiter = ";";
  let bestScore = -1;
  for (const delimiter of candidates) {
    const counts = firstLines.map((line) => splitCsvLine(line, delimiter).length);
    const min = Math.min(...counts);
    if (min > bestScore) {
      bestScore = min;
      bestDelimiter = delimiter;
    }
  }
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => splitCsvLine(line, bestDelimiter).map((cell) => cell.replace(/^"|"$/g, "").trim()));
  return { rows, delimiter: bestDelimiter };
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** Accepts 1 234 567,89 / 1,234,567.89 / 1234567.89 and returns minor units. */
export function parseAmountCell(value: string): number | null {
  if (!value) return null;
  const cleaned = value
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .replace(/[^\d.,\-()]/g, "")
    .replace(/^\((.+)\)$/, "-$1");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) normalized = cleaned.replace(/\./g, "").replace(",", ".");
    else normalized = cleaned.replace(/,/g, "");
  } else if (lastComma > -1) {
    const decimals = cleaned.length - lastComma - 1;
    normalized = decimals === 3 ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  // UZS amounts are conventionally integers; keep integer precision when possible.
  return Math.round(parsed * 100);
}

export function parseDateCell(value: string, fallbackYear?: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();

  let match = trimmed.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;

  match = trimmed.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  match = trimmed.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})/);
  if (match) {
    const months: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
      yan: 1, yanv: 1, fev: 2, mar_: 3, apr_: 4, iyn: 6, iyl: 7, avg: 8, sen: 9, okt: 10, noy: 11, dek: 12,
      янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
    };
    const key = match[2].toLowerCase().replace(/[^a-zа-я]/g, "");
    const month = months[key];
    if (month) return `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  if (fallbackYear) {
    match = trimmed.match(/^(\d{1,2})[-./](\d{1,2})$/);
    if (match) return `${fallbackYear}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  return null;
}

function guessDirection(text: string, amount: number): "in" | "out" {
  const lowered = text.toLowerCase();
  if (amount < 0) return "out";
  if (/(kirim|приход|поступл|credit|incoming|zachisl|зачисл|debited to)/i.test(lowered)) return "in";
  if (/(chiqim|расход|списан|debit|outgoing|payment to|оплата)/i.test(lowered)) return "out";
  return "in";
}

export function parseStatementText(text: string, format: "csv" | "text" = "csv"): ParseResult {
  const { rows } = splitDelimited(text);
  if (!rows.length) {
    return { format, detectedBank: null, rows: [], skipped: 0, warnings: ["The file contains no readable rows."], columns: {} };
  }

  const bankFromText = detectBank(text);
  const headerIndex = rows.findIndex((row) => {
    const map = detectColumns(row);
    return map.date !== null || map.amount !== null || map.debit !== null || map.credit !== null;
  });

  if (headerIndex < 0) {
    return {
      format,
      detectedBank: bankFromText,
      rows: [],
      skipped: rows.length,
      warnings: [
        "BUXAI could not find a header row with date and amount columns. Add a header row (date, description, amount) or enter the transactions manually.",
      ],
      columns: {},
    };
  }

  const columns = detectColumns(rows[headerIndex]);
  const dataRows = rows.slice(headerIndex + 1);
  const parsed: ParsedStatementRow[] = [];
  let skipped = 0;
  const warnings: string[] = [];

  for (const row of dataRows) {
    const joined = row.join(" ");
    if (!joined.trim()) continue;
    const dateRaw = columns.date !== null ? row[columns.date] : "";
    const date = parseDateCell(dateRaw);
    const credit = columns.credit !== null ? parseAmountCell(row[columns.credit] ?? "") : null;
    const debit = columns.debit !== null ? parseAmountCell(row[columns.debit] ?? "") : null;
    const absolute = columns.amount !== null ? parseAmountCell(row[columns.amount] ?? "") : null;

    let amount = 0;
    let direction: "in" | "out" = "in";
    const rowWarnings: string[] = [];

    if ((credit ?? 0) !== 0) {
      amount = Math.abs(credit ?? 0);
      direction = "in";
    } else if ((debit ?? 0) !== 0) {
      amount = Math.abs(debit ?? 0);
      direction = "out";
    } else if (absolute !== null && absolute !== 0) {
      amount = Math.abs(absolute);
      direction = guessDirection(joined, absolute);
    }

    if (!date || amount === 0) {
      skipped += 1;
      continue;
    }
    if (!columns.counterparty && !columns.description) {
      rowWarnings.push("No description column detected — description filled from the raw row.");
    }

    const description =
      (columns.description !== null ? row[columns.description] : "") ||
      row.find((cell) => /[A-Za-zА-Яа-я]{4,}/.test(cell) && !parseDateCell(cell)) ||
      joined;

    parsed.push({
      date,
      description: description.slice(0, 300),
      counterparty: columns.counterparty !== null ? (row[columns.counterparty] || null) : null,
      reference: columns.reference !== null ? (row[columns.reference] || null) : null,
      direction,
      amount,
      raw: joined.slice(0, 400),
      warnings: rowWarnings,
    });
  }

  if (!parsed.length) {
    warnings.push("No transaction rows could be read. Check that the date and amount columns are present, or enter rows manually.");
  }

  return {
    format,
    detectedBank: bankFromText,
    rows: parsed,
    skipped,
    warnings,
    columns: Object.fromEntries(Object.entries(columns).map(([key, value]) => [key, value === null ? null : String(value)])),
  };
}

/* --------------------------------------------------------------- XLSX reader */

type ZipEntry = { name: string; data: Buffer };

/** Minimal ZIP reader — enough to read .xlsx (stored + deflate entries). */
function readZip(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataStart = offset + 30 + nameLength + extraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try {
        data = zlib.inflateRawSync(raw);
      } catch {
        data = Buffer.alloc(0);
      }
    } else {
      data = Buffer.alloc(0);
    }
    if (data.length || uncompressedSize === 0) entries.push({ name, data });
    offset = dataStart + compressedSize;
  }
  return entries;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

export function parseXlsx(buffer: Buffer): string[][] {
  const entries = readZip(buffer);
  if (!entries.length) return [];
  const sheet = entries.find((entry) => /^xl\/worksheets\/sheet1\.xml$/.test(entry.name)) ?? entries.find((entry) => /worksheets\/sheet/.test(entry.name));
  if (!sheet) return [];

  const sharedStrings: string[] = [];
  const sharedEntry = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
  if (sharedEntry) {
    const xml = sharedEntry.data.toString("utf8");
    const items = xml.split(/<si[ >]/).slice(1);
    for (const item of items) {
      const texts = [...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXmlEntities(match[1]));
      sharedStrings.push(texts.join(""));
    }
  }

  const xml = sheet.data.toString("utf8");
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      const refMatch = /r="([A-Z]+)\d+"/.exec(attrs);
      const columnIndex = refMatch ? columnLetterToIndex(refMatch[1]) : cells.length;
      let value = "";
      if (type === "inlineStr") {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXmlEntities(match[1])).join("");
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        value = type === "s" ? (sharedStrings[Number(raw)] ?? "") : decodeXmlEntities(raw);
      }
      while (cells.length < columnIndex) cells.push("");
      cells[columnIndex] = value.trim();
    }
    rows.push(cells);
  }
  return rows.filter((row) => row.some((cell) => cell !== ""));
}

function columnLetterToIndex(letters: string): number {
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

export function parseXlsxToResult(buffer: Buffer): ParseResult {
  const rows = parseXlsx(buffer);
  if (!rows.length) {
    return { format: "xlsx", detectedBank: null, rows: [], skipped: 0, warnings: ["The workbook has no readable rows in its first sheet."], columns: {} };
  }
  const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(";")).join("\n");
  const result = parseStatementText(csv, "csv");
  const bank = detectBank(rows.slice(0, 8).flat().join(" "));
  return { ...result, format: "xlsx", detectedBank: result.detectedBank ?? bank };
}

/* ---------------------------------------------------------------- PDF reader */

/** Best-effort text extraction from PDFs that carry a text layer. */
export function extractPdfText(buffer: Buffer): string {
  const chunks: string[] = [];
  const latin = buffer.toString("latin1");
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(latin)) !== null) {
    const raw = Buffer.from(match[1], "latin1");
    let text: string;
    try {
      text = zlib.inflateSync(raw).toString("latin1");
    } catch {
      try {
        text = zlib.inflateRawSync(raw).toString("latin1");
      } catch {
        text = match[1];
      }
    }
    chunks.push(text);
  }
  const joined = chunks.join("\n");
  const out: string[] = [];
  for (const textMatch of joined.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj|\[((?:[^\]\\]|\\.)*)\]\s*TJ/g)) {
    if (textMatch[1]) out.push(unescapePdfString(textMatch[1]));
    else if (textMatch[2]) {
      const parts = [...textMatch[2].matchAll(/\(((?:\\.|[^\\()])*)\)/g)].map((part) => unescapePdfString(part[1]));
      out.push(parts.join(""));
    }
  }
  if (!out.length) {
    // Fall back to plain text runs found in uncompressed content streams.
    for (const textMatch of latin.matchAll(/\(([\x20-\x7e]{4,})\)/g)) out.push(textMatch[1]);
  }
  return out.join("\n");
}

function unescapePdfString(value: string): string {
  return value
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\[0-7]{1,3}/g, " ");
}

export function parsePdfToResult(buffer: Buffer): ParseResult {
  const text = extractPdfText(buffer);
  const bank = detectBank(text);
  if (!text.trim()) {
    return {
      format: "pdf",
      detectedBank: bank,
      rows: [],
      skipped: 0,
      warnings: [
        "This PDF has no text layer (it looks like a scan). BUXAI does not guess amounts from images of statements — upload the CSV/XLSX export from your bank, or add the transactions manually.",
      ],
      columns: {},
    };
  }

  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const candidates = lines.filter((line) => parseDateCell(line.slice(0, 12)) && /\d[\d\s.,]{2,}/.test(line));
  if (!candidates.length) {
    return {
      format: "pdf",
      detectedBank: bank,
      rows: [],
      skipped: lines.length,
      warnings: [
        "BUXAI found text in this PDF but no transaction lines with a recognisable date and amount. Enter the rows manually or use the bank's CSV export.",
      ],
      columns: {},
    };
  }

  const rows: ParsedStatementRow[] = [];
  for (const line of candidates) {
    const date = parseDateCell(line.slice(0, 12));
    const amounts = [...line.matchAll(/(\d[\d\s]*[.,]\d{2}|\d{4,})/g)].map((m) => parseAmountCell(m[1])).filter((v): v is number => v !== null && v !== 0);
    if (!date || !amounts.length) continue;
    const amount = Math.abs(amounts[amounts.length - 1]);
    rows.push({
      date,
      description: line.slice(0, 240),
      counterparty: null,
      reference: null,
      direction: guessDirection(line, amount),
      amount,
      raw: line.slice(0, 400),
      warnings: ["Direction inferred from the wording — please confirm before importing."],
    });
  }

  return {
    format: "pdf",
    detectedBank: bank,
    rows,
    skipped: Math.max(0, candidates.length - rows.length),
    warnings: ["PDF rows are read best-effort. Review every row before importing."],
    columns: {},
  };
}

export function parseStatementFile(buffer: Buffer, filename: string): ParseResult {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return parseXlsxToResult(buffer);
  if (lower.endsWith(".pdf")) return parsePdfToResult(buffer);
  return parseStatementText(buffer.toString("utf8"), "csv");
}
