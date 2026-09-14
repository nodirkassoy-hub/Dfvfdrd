/**
 * Banking centre: accounts, statement import and reconciliation.
 *
 * Reconciliation never guesses silently: each candidate match carries a score
 * and a human-readable reason, and nothing is posted to the ledger until the
 * user confirms it.
 */
import { createHash } from "node:crypto";
import { all, insert, nowISO, one, run, tx } from "@/lib/db";
import { ValidationError } from "@/lib/accounting/errors";
import { SYSTEM_ACCOUNTS } from "@/lib/accounting/coa";
import { accountIdByCodeOrThrow, postEntryTx } from "@/lib/accounting/engine";
import { formatDate } from "@/lib/dates";
import { recordAudit } from "./company";
import { recordInvoicePayment } from "./sales";
import { recordBillPayment } from "./purchases";
import { detectBank, parseStatementFile, type ParseResult, type ParsedStatementRow } from "./statement-parse";

export type Ctx = { userId?: number | null; userName?: string | null; ip?: string | null };

export type BankAccountRow = {
  id: number;
  name: string;
  kind: "bank" | "cash";
  bankName: string | null;
  accountNumber: string | null;
  mfo: string | null;
  currency: string;
  ledgerAccountId: number;
  ledgerBalance: number;
  unreconciled: number;
  unreconciledAmount: number;
  isDefault: number;
  isArchived: number;
};

export function listBankAccounts(companyId: number, asOf?: string): BankAccountRow[] {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  return all<BankAccountRow>(
    `SELECT b.id, b.name, b.kind, b.bank_name AS bankName, b.account_number AS accountNumber, b.mfo, b.currency,
            b.account_id AS ledgerAccountId,
            COALESCE((SELECT SUM(l.base_debit - l.base_credit) FROM journal_lines l
                        JOIN journal_entries e ON e.id = l.entry_id
                       WHERE l.account_id = b.account_id AND e.status = 'posted' AND e.date <= ?), 0) AS ledgerBalance,
            COALESCE((SELECT COUNT(*) FROM bank_transactions t
                       WHERE t.bank_account_id = b.id AND t.status = 'unmatched'), 0) AS unreconciled,
            COALESCE((SELECT SUM(t.amount) FROM bank_transactions t
                       WHERE t.bank_account_id = b.id AND t.status = 'unmatched'), 0) AS unreconciledAmount,
            b.is_default AS isDefault, b.is_archived AS isArchived
       FROM bank_accounts b
      WHERE b.company_id = ? AND b.is_archived = 0
      ORDER BY b.is_default DESC, b.name`,
    [date, companyId],
  );
}

export function bankTotals(companyId: number, asOf?: string) {
  const accounts = listBankAccounts(companyId, asOf);
  return {
    accounts: accounts.length,
    balance: accounts.reduce((sum, account) => sum + account.ledgerBalance, 0),
    unreconciled: accounts.reduce((sum, account) => sum + account.unreconciled, 0),
    unreconciledAmount: accounts.reduce((sum, account) => sum + account.unreconciledAmount, 0),
    cash: accounts.filter((account) => account.kind === "cash").reduce((sum, account) => sum + account.ledgerBalance, 0),
    bank: accounts.filter((account) => account.kind === "bank").reduce((sum, account) => sum + account.ledgerBalance, 0),
  };
}

export type BankTransactionRow = {
  id: number;
  bankAccountId: number;
  bankAccountName: string;
  date: string;
  description: string;
  counterparty: string | null;
  reference: string | null;
  direction: "in" | "out";
  amount: number;
  currency: string;
  status: string;
  matchConfidenceBp: number;
  matchedEntryId: number | null;
  matchedType: string | null;
  matchedId: number | null;
  journalEntryId: number | null;
  importBatchId: number | null;
  contactId: number | null;
  contactName: string | null;
};

export function listBankTransactions(
  companyId: number,
  filters: { bankAccountId?: number; status?: string; from?: string; to?: string; search?: string; limit?: number; direction?: string } = {},
): BankTransactionRow[] {
  const conditions = ["t.company_id = ?"];
  const params: unknown[] = [companyId];
  if (filters.bankAccountId) {
    conditions.push("t.bank_account_id = ?");
    params.push(filters.bankAccountId);
  }
  if (filters.status && filters.status !== "all") {
    conditions.push("t.status = ?");
    params.push(filters.status);
  }
  if (filters.direction && filters.direction !== "all") {
    conditions.push("t.direction = ?");
    params.push(filters.direction);
  }
  if (filters.from) {
    conditions.push("t.date >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push("t.date <= ?");
    params.push(filters.to);
  }
  if (filters.search) {
    conditions.push("(t.description LIKE ? OR t.counterparty LIKE ? OR t.reference LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
  }
  params.push(filters.limit ?? 300);

  return all<BankTransactionRow>(
    `SELECT t.id, t.bank_account_id AS bankAccountId, b.name AS bankAccountName, t.date, t.description,
            t.counterparty, t.reference, t.direction, t.amount, t.currency, t.status,
            t.match_confidence_bp AS matchConfidenceBp, t.matched_entry_id AS matchedEntryId, t.matched_type AS matchedType,
            t.matched_id AS matchedId, t.journal_entry_id AS journalEntryId, t.import_batch_id AS importBatchId,
            t.contact_id AS contactId, c.name AS contactName
       FROM bank_transactions t
       JOIN bank_accounts b ON b.id = t.bank_account_id
       LEFT JOIN contacts c ON c.id = t.contact_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY t.date DESC, t.id DESC
      LIMIT ?`,
    params,
  );
}

/* ------------------------------------------------------------------ import */

export type ImportPreviewRow = ParsedStatementRow & {
  duplicate: boolean;
  selected: boolean;
  externalId: string;
};

export type ImportPreview = {
  format: ParseResult["format"];
  detectedBank: string | null;
  columns: Record<string, string | null>;
  warnings: string[];
  rows: ImportPreviewRow[];
  skipped: number;
  duplicates: number;
};

function externalIdFor(companyId: number, bankAccountId: number, row: ParsedStatementRow): string {
  return createHash("sha1")
    .update([companyId, bankAccountId, row.date, row.direction, row.amount, row.description, row.reference ?? ""].join("|"))
    .digest("hex")
    .slice(0, 32);
}

export function analyzeStatementFile(companyId: number, bankAccountId: number, filename: string, buffer: Buffer): ImportPreview {
  const account = one<{ id: number }>("SELECT id FROM bank_accounts WHERE id = ? AND company_id = ?", [bankAccountId, companyId]);
  if (!account) throw new ValidationError("ACCOUNT_NOT_FOUND", "Bank account not found");
  const result = parseStatementFile(buffer, filename);

  const rows: ImportPreviewRow[] = result.rows.map((row) => {
    const externalId = externalIdFor(companyId, bankAccountId, row);
    const duplicate = Boolean(
      one<{ id: number }>("SELECT id FROM bank_transactions WHERE company_id = ? AND bank_account_id = ? AND external_id = ?", [
        companyId,
        bankAccountId,
        externalId,
      ]),
    );
    return { ...row, externalId, duplicate, selected: !duplicate };
  });

  return {
    format: result.format,
    detectedBank: result.detectedBank ?? detectBank(filename),
    columns: result.columns,
    warnings: result.warnings,
    rows,
    skipped: result.skipped,
    duplicates: rows.filter((row) => row.duplicate).length,
  };
}

export function commitStatementImport(
  input: {
    companyId: number;
    bankAccountId: number;
    filename: string;
    source: "csv" | "xlsx" | "pdf" | "text";
    detectedBank?: string | null;
    rows: ParsedStatementRow[];
  },
  ctx: Ctx = {},
): { batchId: number; imported: number; duplicates: number } {
  return tx(() => {
    const stamp = nowISO();
    const account = one<{ currency: string }>("SELECT currency FROM bank_accounts WHERE id = ? AND company_id = ?", [
      input.bankAccountId,
      input.companyId,
    ]);
    if (!account) throw new ValidationError("ACCOUNT_NOT_FOUND", "Bank account not found");
    const batchId = insert(
      `INSERT INTO import_batches (company_id, source, filename, bank_account_id, rows_total, rows_imported, rows_skipped,
        detected_bank, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
      [input.companyId, input.source, input.filename, input.bankAccountId, input.rows.length, input.detectedBank ?? null, ctx.userId ?? null, stamp],
    );

    let imported = 0;
    let duplicates = 0;
    for (const row of input.rows) {
      const externalId = externalIdFor(input.companyId, input.bankAccountId, row);
      const exists = one<{ id: number }>(
        "SELECT id FROM bank_transactions WHERE company_id = ? AND bank_account_id = ? AND external_id = ?",
        [input.companyId, input.bankAccountId, externalId],
      );
      if (exists) {
        duplicates += 1;
        continue;
      }
      insert(
        `INSERT INTO bank_transactions
          (company_id, bank_account_id, date, description, counterparty, reference, direction, amount, currency,
           status, import_batch_id, external_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unmatched', ?, ?, ?, ?)`,
        [
          input.companyId,
          input.bankAccountId,
          row.date,
          row.description,
          row.counterparty,
          row.reference,
          row.direction,
          row.amount,
          account.currency,
          batchId,
          externalId,
          ctx.userId ?? null,
          stamp,
        ],
      );
      imported += 1;
    }

    run("UPDATE import_batches SET rows_imported = ?, rows_skipped = ? WHERE id = ?", [imported, duplicates, batchId]);
    recordAudit({
      companyId: input.companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "import",
      entityType: "bank_statement",
      entityId: batchId,
      summary: `Imported ${imported} bank transactions from ${input.filename} (${duplicates} duplicates skipped)`,
      after: { imported, duplicates },
      ip: ctx.ip,
    });
    return { batchId, imported, duplicates };
  });
}

export function createBankTransaction(
  input: {
    companyId: number;
    bankAccountId: number;
    date: string;
    description: string;
    direction: "in" | "out";
    amount: number;
    counterparty?: string | null;
    reference?: string | null;
  },
  ctx: Ctx = {},
): number {
  if (input.amount <= 0) throw new ValidationError("AMOUNT_ZERO", "Amount must be greater than zero");
  const externalId = createHash("sha1")
    .update([input.companyId, input.bankAccountId, input.date, input.direction, input.amount, input.description, nowISO()].join("|"))
    .digest("hex")
    .slice(0, 32);
  return insert(
    `INSERT INTO bank_transactions
      (company_id, bank_account_id, date, description, counterparty, reference, direction, amount, currency, status,
       external_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UZS', 'unmatched', ?, ?, ?)`,
    [
      input.companyId,
      input.bankAccountId,
      input.date,
      input.description,
      input.counterparty ?? null,
      input.reference ?? null,
      input.direction,
      input.amount,
      externalId,
      ctx.userId ?? null,
      nowISO(),
    ],
  );
}

/* ---------------------------------------------------------- reconciliation */

export type MatchCandidate = {
  type: "invoice" | "bill" | "expense" | "payment";
  id: number;
  label: string;
  contactName: string;
  date: string;
  amount: number;
  direction: "in" | "out";
  score: number; // 0..10000
  reasons: string[];
  status: string;
};

export type ReconciliationRow = {
  transaction: BankTransactionRow;
  candidates: MatchCandidate[];
  best: MatchCandidate | null;
  suggestion: "matched" | "potential" | "unmatched" | "duplicate" | "amount_mismatch";
};

function similarity(a: string, b: string): number {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-zа-я0-9\s]/gi, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2);
  const left = new Set(normalize(a));
  const right = new Set(normalize(b));
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const token of left) if (right.has(token)) hits += 1;
  return hits / Math.max(left.size, right.size);
}

function scoreCandidate(
  txn: { date: string; amount: number; direction: "in" | "out"; description: string; counterparty: string | null; reference: string | null },
  candidate: { date: string; amount: number; direction: "in" | "out"; label: string; contactName: string },
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (txn.direction === candidate.direction) {
    score += 2000;
    reasons.push("same direction");
  } else {
    reasons.push("opposite direction — check whether this is a refund");
  }

  const tolerance = Math.max(100, Math.round(txn.amount * 0.01));
  const diff = Math.abs(txn.amount - candidate.amount);
  if (diff === 0) {
    score += 5000;
    reasons.push("amount matches exactly");
  } else if (diff <= tolerance) {
    score += 3000;
    reasons.push(`amount within 1% (difference ${diff})`);
  } else {
    return { score: Math.min(score, 2500), reasons: [...reasons, "amount differs"] };
  }

  const dayDiff = Math.abs((Date.parse(txn.date) - Date.parse(candidate.date)) / 86_400_000);
  if (dayDiff === 0) {
    score += 1500;
    reasons.push("same date");
  } else if (dayDiff <= 3) {
    score += 1000;
    reasons.push(`${dayDiff} day(s) apart`);
  } else if (dayDiff <= 10) {
    score += 400;
    reasons.push(`${dayDiff} days apart`);
  }

  const text = `${txn.description} ${txn.counterparty ?? ""} ${txn.reference ?? ""}`;
  const nameScore = similarity(text, candidate.contactName);
  if (nameScore > 0.3) {
    score += Math.round(Math.min(nameScore, 1) * 1500);
    reasons.push("counterparty name looks similar");
  }
  if (candidate.label && text.toLowerCase().includes(candidate.label.toLowerCase())) {
    score += 800;
    reasons.push("document number appears in the bank description");
  }

  return { score: Math.min(score, 10000), reasons };
}

export function reconciliationRows(companyId: number, bankAccountId: number, asOf?: string): ReconciliationRow[] {
  const transactions = listBankTransactions(companyId, { bankAccountId, limit: 500 });
  const periods = { from: "2000-01-01", to: asOf ?? new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10) };

  const invoices = all<{ id: number; number: string; date: string; amount: number; contactName: string; status: string }>(
    `SELECT i.id, i.number AS number, i.issue_date AS date, i.total - i.amount_paid AS amount, c.name AS contactName, i.status
       FROM invoices i JOIN contacts c ON c.id = i.contact_id
      WHERE i.company_id = ? AND i.status IN ('sent','partially_paid','overdue') AND i.total > i.amount_paid
        AND i.issue_date BETWEEN ? AND ?`,
    [companyId, periods.from, periods.to],
  );
  const bills = all<{ id: number; number: string; date: string; amount: number; contactName: string; status: string }>(
    `SELECT b.id, b.number AS number, b.issue_date AS date, b.total - b.amount_paid AS amount, c.name AS contactName, b.status
       FROM bills b JOIN contacts c ON c.id = b.contact_id
      WHERE b.company_id = ? AND b.total > b.amount_paid AND b.status IN ('open','partially_paid','overdue')`,
    [companyId],
  );
  const expenses = all<{ id: number; number: string; date: string; amount: number; contactName: string }>(
    `SELECT x.id, x.number AS number, x.date AS date, x.amount + x.tax_amount AS amount,
            COALESCE(c.name, x.description, 'Expense') AS contactName
       FROM expenses x LEFT JOIN contacts c ON c.id = x.contact_id
      WHERE x.company_id = ? AND x.is_paid = 0`,
    [companyId],
  );

  return transactions.map((transaction) => {
    if (transaction.status !== "unmatched") {
      return { transaction, candidates: [], best: null, suggestion: "matched" as const };
    }
    const txn = {
      date: transaction.date,
      amount: transaction.amount,
      direction: transaction.direction,
      description: transaction.description,
      counterparty: transaction.counterparty,
      reference: transaction.reference,
    };

    const pool: MatchCandidate[] = [];
    const addCandidate = (
      type: MatchCandidate["type"],
      id: number,
      label: string,
      contactName: string,
      date: string,
      amount: number,
      direction: "in" | "out",
      status: string,
    ) => {
      const { score, reasons } = scoreCandidate(txn, { date, amount, direction, label, contactName });
      pool.push({ type, id, label, contactName, date, amount, direction, score, reasons, status });
    };

    if (transaction.direction === "in") {
      for (const invoice of invoices) {
        addCandidate("invoice", invoice.id, invoice.number, invoice.contactName, invoice.date, invoice.amount, "in", invoice.status);
      }
    } else {
      for (const bill of bills) {
        addCandidate("bill", bill.id, bill.number, bill.contactName, bill.date, bill.amount, "out", bill.status);
      }
      for (const expense of expenses) {
        addCandidate("expense", expense.id, expense.number, expense.contactName, expense.date, expense.amount, "out", "unpaid");
      }
    }

    pool.sort((a, b) => b.score - a.score);
    const best = pool[0] ?? null;

    // Duplicate detection: an identical imported line already reconciled.
    const duplicate = Boolean(
      one<{ id: number }>(
        `SELECT id FROM bank_transactions
          WHERE company_id = ? AND bank_account_id = ? AND id <> ? AND date = ? AND amount = ? AND direction = ?
            AND status IN ('matched','unmatched') AND description = ?`,
        [companyId, bankAccountId, transaction.id, transaction.date, transaction.amount, transaction.direction, transaction.description],
      ),
    );

    const suggestion: ReconciliationRow["suggestion"] = duplicate
      ? "duplicate"
      : best && best.score >= 8000
        ? "matched"
        : best && best.score >= 5000
          ? "potential"
          : best && best.score >= 3000
            ? "amount_mismatch"
            : "unmatched";

    return { transaction, candidates: pool.slice(0, 4), best, suggestion };
  });
}

export function reconciliationProgress(companyId: number, bankAccountId: number) {
  const row = one<{ total: number; matched: number; ignored: number; unmatched: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) AS matched,
            SUM(CASE WHEN status = 'ignored' THEN 1 ELSE 0 END) AS ignored,
            SUM(CASE WHEN status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched
       FROM bank_transactions WHERE company_id = ? AND bank_account_id = ?`,
    [companyId, bankAccountId],
  );
  const total = row?.total ?? 0;
  const matched = row?.matched ?? 0;
  const ignored = row?.ignored ?? 0;
  const unmatched = row?.unmatched ?? 0;
  const denominator = Math.max(1, total - ignored);
  return {
    total,
    matched,
    ignored,
    unmatched,
    percent: total === 0 ? 100 : Math.round((matched / denominator) * 100),
  };
}

export type ConfirmMatchInput = {
  companyId: number;
  bankTransactionId: number;
  targetType: "invoice" | "bill" | "expense" | "account";
  targetId?: number;
  accountId?: number;
  categoryId?: number | null;
  contactId?: number | null;
  memo?: string;
  /** Amount actually allocated (defaults to the full bank amount). */
  amount?: number;
};

/**
 * Confirm a match. This is the only path that turns a bank line into a posted
 * transaction, and it always produces a balanced entry.
 */
export function confirmMatch(input: ConfirmMatchInput, ctx: Ctx = {}): { entryId: number; matchedType: string; matchedId: number | null } {
  return tx(() => {
    const txn = one<{
      id: number;
      bank_account_id: number;
      date: string;
      description: string;
      direction: "in" | "out";
      amount: number;
      status: string;
      counterparty: string | null;
    }>("SELECT * FROM bank_transactions WHERE id = ? AND company_id = ?", [input.bankTransactionId, input.companyId]);
    if (!txn) throw new ValidationError("NOT_FOUND", "Bank transaction not found");
    if (txn.status === "matched") throw new ValidationError("ALREADY_MATCHED", "This bank line is already reconciled");

    const bankAccount = one<{ id: number; account_id: number }>(
      "SELECT id, account_id FROM bank_accounts WHERE id = ? AND company_id = ?",
      [txn.bank_account_id, input.companyId],
    );
    if (!bankAccount) throw new ValidationError("ACCOUNT_NOT_FOUND", "Bank account not found");

    const amount = Math.round(input.amount ?? txn.amount);
    if (amount <= 0) throw new ValidationError("AMOUNT_ZERO", "Amount must be greater than zero");

    let entryId: number;
    let matchedId: number | null = null;

    if (input.targetType === "invoice" && input.targetId) {
      const result = recordInvoicePayment(
        {
          companyId: input.companyId,
          invoiceId: input.targetId,
          amount,
          date: txn.date,
          bankAccountId: txn.bank_account_id,
          reference: txn.description.slice(0, 60),
          notes: `Matched to bank line #${txn.id}`,
        },
        ctx,
      );
      entryId = result.entryId;
      matchedId = input.targetId;
    } else if (input.targetType === "bill" && input.targetId) {
      const result = recordBillPayment(
        {
          companyId: input.companyId,
          billId: input.targetId,
          amount,
          date: txn.date,
          bankAccountId: txn.bank_account_id,
          reference: txn.description.slice(0, 60),
          notes: `Matched to bank line #${txn.id}`,
        },
        ctx,
      );
      entryId = result.entryId;
      matchedId = input.targetId;
    } else {
      const counterAccount =
        input.accountId ??
        (txn.direction === "in" ? accountIdByCodeOrThrow(input.companyId, SYSTEM_ACCOUNTS.AR_TRADE) : accountIdByCodeOrThrow(input.companyId, SYSTEM_ACCOUNTS.AP_TRADE));
      const entry = postEntryTx({
        companyId: input.companyId,
        date: txn.date,
        memo: input.memo ?? `${txn.description.slice(0, 80)} (bank #${txn.id})`,
        reference: txn.counterparty ?? null,
        sourceType: "bank",
        sourceId: txn.id,
        userId: ctx.userId ?? null,
        lines:
          txn.direction === "in"
            ? [
                { accountId: bankAccount.account_id, debit: amount, description: txn.description.slice(0, 120), contactId: input.contactId ?? null },
                { accountId: counterAccount, credit: amount, description: txn.description.slice(0, 120), contactId: input.contactId ?? null },
              ]
            : [
                { accountId: counterAccount, debit: amount, description: txn.description.slice(0, 120), contactId: input.contactId ?? null },
                { accountId: bankAccount.account_id, credit: amount, description: txn.description.slice(0, 120), contactId: input.contactId ?? null },
              ],
      });
      entryId = entry.id;
      matchedId = input.targetId ?? null;
    }

    const confidence = input.targetType === "account" ? 7000 : 10000;
    run(
      `UPDATE bank_transactions
          SET status = 'matched', matched_entry_id = ?, matched_type = ?, matched_id = ?, journal_entry_id = ?,
              match_confidence_bp = ?, matched_at = ?, matched_by = ?, account_id = COALESCE(?, account_id),
              category_id = COALESCE(?, category_id), contact_id = COALESCE(?, contact_id)
        WHERE id = ? AND company_id = ?`,
      [
        entryId,
        input.targetType,
        matchedId,
        entryId,
        confidence,
        nowISO(),
        ctx.userId ?? null,
        input.accountId ?? null,
        input.categoryId ?? null,
        input.contactId ?? null,
        txn.id,
        input.companyId,
      ],
    );

    recordAudit({
      companyId: input.companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "reconcile",
      entityType: "bank_transaction",
      entityId: txn.id,
      summary: `Reconciled bank line "${txn.description.slice(0, 60)}" with ${input.targetType}${matchedId ? ` #${matchedId}` : ""} (entry ${entryId})`,
      after: { entryId, matchedType: input.targetType, matchedId },
      ip: ctx.ip,
    });

    return { entryId, matchedType: input.targetType, matchedId };
  });
}

/** Split a bank line across several accounts; the total must equal the bank amount. */
export function createTransactionFromBankTxn(
  input: {
    companyId: number;
    bankTransactionId: number;
    splits: { accountId: number; categoryId?: number | null; amount: number; memo?: string }[];
    contactId?: number | null;
    memo?: string;
  },
  ctx: Ctx = {},
): { entryId: number } {
  return tx(() => {
    const txn = one<{
      id: number;
      bank_account_id: number;
      date: string;
      description: string;
      direction: "in" | "out";
      amount: number;
      status: string;
    }>("SELECT * FROM bank_transactions WHERE id = ? AND company_id = ?", [input.bankTransactionId, input.companyId]);
    if (!txn) throw new ValidationError("NOT_FOUND", "Bank transaction not found");
    if (txn.status === "matched") throw new ValidationError("ALREADY_MATCHED", "This bank line is already reconciled");
    if (!input.splits.length) throw new ValidationError("NO_SPLITS", "Add at least one allocation");

    const total = input.splits.reduce((sum, split) => sum + Math.round(split.amount), 0);
    if (total !== txn.amount) {
      throw new ValidationError("SPLIT_TOTAL", `Allocations add up to ${total} but the bank line is ${txn.amount}`);
    }

    const bankAccount = one<{ account_id: number }>("SELECT account_id FROM bank_accounts WHERE id = ?", [txn.bank_account_id]);
    if (!bankAccount) throw new ValidationError("ACCOUNT_NOT_FOUND", "Bank account not found");

    const entry = postEntryTx({
      companyId: input.companyId,
      date: txn.date,
      memo: input.memo ?? txn.description.slice(0, 120),
      sourceType: "bank",
      sourceId: txn.id,
      userId: ctx.userId ?? null,
      lines:
        txn.direction === "in"
          ? [
              { accountId: bankAccount.account_id, debit: txn.amount, description: txn.description.slice(0, 120) },
              ...input.splits.map((split) => ({
                accountId: split.accountId,
                credit: Math.round(split.amount),
                description: split.memo ?? txn.description.slice(0, 120),
                contactId: input.contactId ?? null,
              })),
            ]
          : [
              ...input.splits.map((split) => ({
                accountId: split.accountId,
                debit: Math.round(split.amount),
                description: split.memo ?? txn.description.slice(0, 120),
                contactId: input.contactId ?? null,
              })),
              { accountId: bankAccount.account_id, credit: txn.amount, description: txn.description.slice(0, 120) },
            ],
    });

    for (const split of input.splits) {
      insert("INSERT INTO bank_txn_splits (bank_txn_id, account_id, category_id, amount, memo) VALUES (?, ?, ?, ?, ?)", [
        txn.id,
        split.accountId,
        split.categoryId ?? null,
        Math.round(split.amount),
        split.memo ?? null,
      ]);
    }

    run(
      `UPDATE bank_transactions SET status = 'matched', matched_entry_id = ?, matched_type = 'split', journal_entry_id = ?,
         match_confidence_bp = 9000, matched_at = ?, matched_by = ?, contact_id = ?, account_id = ?
       WHERE id = ? AND company_id = ?`,
      [entry.id, entry.id, nowISO(), ctx.userId ?? null, input.contactId ?? null, input.splits[0].accountId, txn.id, input.companyId],
    );

    recordAudit({
      companyId: input.companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "reconcile",
      entityType: "bank_transaction",
      entityId: txn.id,
      summary: `Split bank line into ${input.splits.length} allocations (entry ${entry.id})`,
      after: { entryId: entry.id, splits: input.splits.length },
      ip: ctx.ip,
    });

    return { entryId: entry.id };
  });
}

export function setBankTransactionStatus(
  companyId: number,
  bankTransactionId: number,
  status: "ignored" | "unmatched",
  ctx: Ctx = {},
): void {
  return tx(() => {
    const txn = one<{ status: string; matched_entry_id: number | null; journal_entry_id: number | null }>(
      "SELECT status, matched_entry_id, journal_entry_id FROM bank_transactions WHERE id = ? AND company_id = ?",
      [bankTransactionId, companyId],
    );
    if (!txn) throw new ValidationError("NOT_FOUND", "Bank transaction not found");
    if (status === "unmatched" && txn.matched_entry_id) {
      throw new ValidationError(
        "REQUIRES_REVERSAL",
        "This line has a posted journal entry. Reverse the entry first — BUXAI never removes a posted entry silently.",
      );
    }
    run("UPDATE bank_transactions SET status = ?, matched_at = ?, matched_by = ? WHERE id = ? AND company_id = ?", [
      status,
      nowISO(),
      ctx.userId ?? null,
      bankTransactionId,
      companyId,
    ]);
    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: status === "ignored" ? "ignore" : "reopen",
      entityType: "bank_transaction",
      entityId: bankTransactionId,
      summary: `Bank line marked as ${status}`,
      ip: ctx.ip,
    });
  });
}

export function deleteBankTransaction(companyId: number, bankTransactionId: number, ctx: Ctx = {}): void {
  return tx(() => {
    const txn = one<{ matched_entry_id: number | null }>(
      "SELECT matched_entry_id FROM bank_transactions WHERE id = ? AND company_id = ?",
      [bankTransactionId, companyId],
    );
    if (!txn) throw new ValidationError("NOT_FOUND", "Bank transaction not found");
    if (txn.matched_entry_id) throw new ValidationError("MATCHED", "Reconciled bank lines cannot be deleted — reverse the entry first");
    run("DELETE FROM bank_transactions WHERE id = ? AND company_id = ?", [bankTransactionId, companyId]);
    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "delete",
      entityType: "bank_transaction",
      entityId: bankTransactionId,
      summary: "Deleted an unreconciled bank line",
      ip: ctx.ip,
    });
  });
}

export function importBatches(companyId: number, limit = 20) {
  return all<{
    id: number;
    source: string;
    filename: string;
    rowsTotal: number;
    rowsImported: number;
    rowsSkipped: number;
    detectedBank: string | null;
    createdAt: string;
    bankAccountName: string | null;
  }>(
    `SELECT i.id, i.source, i.filename, i.rows_total AS rowsTotal, i.rows_imported AS rowsImported,
            i.rows_skipped AS rowsSkipped, i.detected_bank AS detectedBank, i.created_at AS createdAt,
            b.name AS bankAccountName
       FROM import_batches i LEFT JOIN bank_accounts b ON b.id = i.bank_account_id
      WHERE i.company_id = ? ORDER BY i.id DESC LIMIT ?`,
    [companyId, limit],
  );
}

export function statementPreviewLabel(row: ParsedStatementRow): string {
  return `${formatDate(row.date)} · ${row.direction === "in" ? "+" : "−"}${row.amount / 100} · ${row.description.slice(0, 60)}`;
}
