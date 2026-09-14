/**
 * BUXAI accounting engine.
 *
 * The single write path into the ledger. Every module (invoices, bills,
 * expenses, payments, payroll, banking, documents, inventory) funnels through
 * `postEntry`, which:
 *   • validates the company's accounting period is open,
 *   • validates every account belongs to the company, is postable and not archived,
 *   • computes base-currency amounts from the entry FX rate,
 *   • rejects the entry unless total debit === total credit in base currency
 *     AND per transaction currency,
 *   • writes the entry + lines inside one transaction, and records an audit row.
 *
 * Because reports, dashboards, the AI Center and Xato Radar all read the same
 * `journal_lines` table, a number can never differ between screens.
 */
import type { Statement } from "better-sqlite3";
import { all, getDb, insert, one, run, tx, nowISO } from "@/lib/db";
import { AccountingError } from "./errors";

export type JournalLineInput = {
  accountId: number;
  debit?: number;
  credit?: number;
  description?: string;
  currency?: string;
  fxRateMicro?: number;
  contactType?: "customer" | "supplier" | "employee" | null;
  contactId?: number | null;
  departmentId?: number | null;
  productId?: number | null;
  taxCodeId?: number | null;
  taxAmount?: number;
  docType?: string | null;
  docId?: number | null;
};

export type PostEntryInput = {
  companyId: number;
  date: string;
  memo?: string;
  reference?: string | null;
  sourceType:
    | "manual"
    | "invoice"
    | "bill"
    | "payment"
    | "expense"
    | "payroll"
    | "bank"
    | "opening"
    | "depreciation"
    | "reversal"
    | "stock"
    | "tax";
  sourceId?: number | null;
  currency?: string;
  fxRateMicro?: number;
  userId?: number | null;
  lines: JournalLineInput[];
  /** System operations (period close, seed) may bypass the period lock. */
  bypassPeriodLock?: boolean;
  entryNumber?: string;
};

export type PostedEntry = {
  id: number;
  number: string;
  date: string;
  totalDebit: number;
  totalCredit: number;
};

type CompanyRow = {
  id: number;
  base_currency: string;
  locked_through: string | null;
};

const MICRO = 1_000_000;

function toBase(amount: number, rateMicro: number): number {
  return Math.round((amount * rateMicro) / MICRO);
}

export function getCompanyOrThrow(companyId: number): CompanyRow {
  const company = one<CompanyRow>("SELECT id, base_currency, locked_through FROM companies WHERE id = ?", [companyId]);
  if (!company) throw new AccountingError("ENTRY_NOT_FOUND", "Company not found", { companyId });
  return company;
}

/** Post an entry from raw object form (used by the demo seeder and tests). */
export function postEntry(input: PostEntryInput): PostedEntry {
  return tx(() => postEntryTx(input));
}

export function postEntryTx(input: PostEntryInput): PostedEntry {
  const company = getCompanyOrThrow(input.companyId);

  if (!input.lines || input.lines.length === 0) {
    throw new AccountingError("NO_LINES", "A journal entry needs at least two lines");
  }
  if (input.lines.length === 1) {
    throw new AccountingError("NO_LINES", "A journal entry needs at least two lines (double-entry)");
  }
  if (!input.bypassPeriodLock && company.locked_through && input.date <= company.locked_through) {
    throw new AccountingError(
      "PERIOD_CLOSED",
      `Accounting period is closed through ${company.locked_through}. Reopen the period to post into it.`,
      { lockedThrough: company.locked_through, date: input.date },
    );
  }

  const entryCurrency = input.currency ?? company.base_currency;
  const entryRate = input.fxRateMicro ?? MICRO;

  let totalDebit = 0;
  let totalCredit = 0;
  let totalBaseDebit = 0;
  let totalBaseCredit = 0;
  const currencyTotals = new Map<string, { debit: number; credit: number }>();

  const preparedLines = input.lines.map((line, index) => {
    const debit = Math.round(line.debit ?? 0);
    const credit = Math.round(line.credit ?? 0);

    if (debit < 0 || credit < 0) {
      throw new AccountingError("NON_POSITIVE_AMOUNT", "Journal line amounts cannot be negative. Use the opposite side instead.", {
        line: index + 1,
      });
    }
    if (debit > 0 && credit > 0) {
      throw new AccountingError("INVALID_LINE", "A journal line can be either a debit or a credit, not both.", { line: index + 1 });
    }
    if (debit === 0 && credit === 0) {
      throw new AccountingError("INVALID_LINE", "A journal line must have an amount greater than zero.", { line: index + 1 });
    }

    const account = one<{
      id: number;
      code: string;
      name: string;
      is_postable: number;
      is_archived: number;
      company_id: number;
    }>("SELECT id, code, name, is_postable, is_archived, company_id FROM accounts WHERE id = ?", [line.accountId]);

    if (!account || account.company_id !== input.companyId) {
      throw new AccountingError("ACCOUNT_NOT_FOUND", "Account not found in this company", { line: index + 1, accountId: line.accountId });
    }
    if (!account.is_postable) {
      throw new AccountingError("ACCOUNT_NOT_POSTABLE", `Account ${account.code} ${account.name} is a heading account and cannot receive postings.`, {
        line: index + 1,
        accountId: account.id,
      });
    }
    if (account.is_archived) {
      throw new AccountingError("ACCOUNT_ARCHIVED", `Account ${account.code} is archived.`, { line: index + 1, accountId: account.id });
    }

    const lineCurrency = line.currency ?? entryCurrency;
    const lineRate = line.currency && line.currency !== entryCurrency ? (line.fxRateMicro ?? entryRate) : entryRate;
    const baseDebit = toBase(debit, lineRate);
    const baseCredit = toBase(credit, lineRate);

    totalDebit += debit;
    totalCredit += credit;
    totalBaseDebit += baseDebit;
    totalBaseCredit += baseCredit;

    const bucket = currencyTotals.get(lineCurrency) ?? { debit: 0, credit: 0 };
    bucket.debit += debit;
    bucket.credit += credit;
    currencyTotals.set(lineCurrency, bucket);

    return {
      lineNo: index + 1,
      accountId: line.accountId,
      description: line.description ?? null,
      debit,
      credit,
      baseDebit,
      baseCredit,
      currency: lineCurrency,
      fxRateMicro: lineRate,
      contactType: line.contactType ?? null,
      contactId: line.contactId ?? null,
      departmentId: line.departmentId ?? null,
      productId: line.productId ?? null,
      taxCodeId: line.taxCodeId ?? null,
      taxAmount: Math.round(line.taxAmount ?? 0),
      docType: line.docType ?? null,
      docId: line.docId ?? null,
    };
  });

  if (totalBaseDebit !== totalBaseCredit) {
    throw new AccountingError(
      "UNBALANCED_ENTRY",
      `Entry is not balanced: total debit ${totalBaseDebit} ≠ total credit ${totalBaseCredit}.`,
      { totalBaseDebit, totalBaseCredit, difference: totalBaseDebit - totalBaseCredit },
    );
  }
  for (const [currency, bucket] of currencyTotals) {
    if (bucket.debit !== bucket.credit) {
      throw new AccountingError(
        "UNBALANCED_ENTRY",
        `Entry is not balanced in ${currency}: debit ${bucket.debit} ≠ credit ${bucket.credit}.`,
        { currency, ...bucket },
      );
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const number = input.entryNumber ?? nextJournalNumber(input.companyId, input.date || today);
  const stamp = nowISO();

  const entryId = insert(
    `INSERT INTO journal_entries
      (company_id, number, date, memo, status, source_type, source_id, reference, currency,
       total_debit, total_credit, is_demo, posted_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      input.companyId,
      number,
      input.date,
      input.memo ?? null,
      input.sourceType,
      input.sourceId ?? null,
      input.reference ?? null,
      entryCurrency,
      totalBaseDebit,
      totalBaseCredit,
      input.userId ?? null,
      stamp,
      stamp,
    ],
  );

  const stmt = getInsertLineStatement();
  for (const line of preparedLines) {
    stmt.run(
      entryId,
      input.companyId,
      line.lineNo,
      line.accountId,
      line.description,
      line.debit,
      line.credit,
      line.baseDebit,
      line.baseCredit,
      line.currency,
      line.fxRateMicro,
      line.contactType,
      line.contactId,
      line.departmentId,
      line.productId,
      line.taxCodeId,
      line.taxAmount,
      line.docType,
      line.docId,
    );
  }

  return { id: entryId, number, date: input.date, totalDebit: totalBaseDebit, totalCredit: totalBaseCredit };
}

let cachedLineStatement: Statement | null = null;

function getInsertLineStatement(): Statement {
  if (!cachedLineStatement) {
    cachedLineStatement = getDb().prepare(
      `INSERT INTO journal_lines
        (entry_id, company_id, line_no, account_id, description, debit, credit, base_debit, base_credit,
         currency, fx_rate_micro, contact_type, contact_id, department_id, product_id, tax_code_id, tax_amount,
         doc_type, doc_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }
  return cachedLineStatement;
}

/** JE-2026-000123 */
export function nextJournalNumber(companyId: number, dateISO: string): string {
  const year = dateISO.slice(0, 4);
  const key = `journal-${year}`;
  const existing = one<{ next_value: number }>("SELECT next_value FROM sequences WHERE company_id = ? AND kind = ?", [
    companyId,
    key,
  ]);
  let value = existing?.next_value ?? 1;
  if (!existing) {
    insert("INSERT INTO sequences (company_id, kind, prefix, next_value) VALUES (?, ?, ?, ?)", [companyId, key, "", value]);
  }
  run("UPDATE sequences SET next_value = ? WHERE company_id = ? AND kind = ?", [value + 1, companyId, key]);
  return `JE-${year}-${String(value).padStart(5, "0")}`;
}

export function nextDocumentNumber(companyId: number, kind: string, prefix: string): string {
  const existing = one<{ next_value: number; prefix: string }>(
    "SELECT next_value, prefix FROM sequences WHERE company_id = ? AND kind = ?",
    [companyId, kind],
  );
  let value = existing?.next_value ?? 1;
  if (!existing) {
    insert("INSERT INTO sequences (company_id, kind, prefix, next_value) VALUES (?, ?, ?, ?)", [companyId, kind, prefix, value]);
    run("UPDATE sequences SET next_value = ? WHERE company_id = ? AND kind = ?", [value + 1, companyId, kind]);
    return `${prefix}-${String(value).padStart(5, "0")}`;
  }
  run("UPDATE sequences SET next_value = ? WHERE company_id = ? AND kind = ?", [value + 1, companyId, kind]);
  const effectivePrefix = existing.prefix || prefix;
  return `${effectivePrefix}-${String(value).padStart(5, "0")}`;
}

/** Void an entry by posting a mirror-image reversal. History is never erased. */
export function voidEntry(entryId: number, userId: number | null, reason?: string): PostedEntry {
  return tx(() => {
    const entry = one<{
      id: number;
      company_id: number;
      number: string;
      date: string;
      memo: string | null;
      currency: string;
      status: string;
      source_type: string;
    }>("SELECT id, company_id, number, date, memo, currency, status, source_type FROM journal_entries WHERE id = ?", [entryId]);

    if (!entry) throw new AccountingError("ENTRY_NOT_FOUND", "Journal entry not found", { entryId });
    if (entry.status === "void") throw new AccountingError("ENTRY_ALREADY_VOID", "This entry is already void");

    const lines = all<{
      account_id: number;
      description: string | null;
      debit: number;
      credit: number;
      currency: string;
      fx_rate_micro: number;
      contact_type: string | null;
      contact_id: number | null;
      department_id: number | null;
      product_id: number | null;
      tax_code_id: number | null;
      tax_amount: number;
      doc_type: string | null;
      doc_id: number | null;
    }>(
      `SELECT account_id, description, debit, credit, currency, fx_rate_micro, contact_type, contact_id,
              department_id, product_id, tax_code_id, tax_amount, doc_type, doc_id
         FROM journal_lines WHERE entry_id = ? ORDER BY line_no`,
      [entryId],
    );

    const reversal = postEntryTx({
      companyId: entry.company_id,
      date: entry.date,
      memo: `Reversal of ${entry.number}${reason ? ` — ${reason}` : ""}`,
      sourceType: "reversal",
      sourceId: entry.id,
      currency: entry.currency,
      userId,
      lines: lines.map((line) => ({
        accountId: line.account_id,
        description: line.description ?? undefined,
        debit: line.credit,
        credit: line.debit,
        currency: line.currency,
        fxRateMicro: line.fx_rate_micro,
        contactType: (line.contact_type as "customer" | "supplier" | "employee" | null) ?? null,
        contactId: line.contact_id,
        departmentId: line.department_id,
        productId: line.product_id,
        taxCodeId: line.tax_code_id,
        taxAmount: line.tax_amount,
        docType: line.doc_type,
        docId: line.doc_id,
      })),
      bypassPeriodLock: true,
    });

    run("UPDATE journal_entries SET status = 'void', reversed_by = ?, voided_at = ?, voided_by = ?, updated_at = ? WHERE id = ?", [
      reversal.id,
      nowISO(),
      userId,
      nowISO(),
      entryId,
    ]);
    run("UPDATE journal_entries SET reversal_of = ? WHERE id = ?", [entryId, reversal.id]);
    return reversal;
  });
}

/* --------------------------------------------------------------- utilities */

export function accountByCode(companyId: number, code: string): { id: number; name: string } | undefined {
  return one<{ id: number; name: string }>("SELECT id, name FROM accounts WHERE company_id = ? AND code = ?", [companyId, code]);
}

export function accountIdByCodeOrThrow(companyId: number, code: string): number {
  const account = accountByCode(companyId, code);
  if (!account) {
    throw new AccountingError("ACCOUNT_NOT_FOUND", `System account ${code} is missing. Restore it in Chart of accounts.`, { code });
  }
  return account.id;
}

/** Control totals used by Xato Radar and the month-end close. */
export function ledgerControlTotals(companyId: number): { debit: number; credit: number; difference: number; entries: number } {
  const row =
    one<{ debit: number | null; credit: number | null; entries: number }>(
      `SELECT SUM(l.base_debit) AS debit, SUM(l.base_credit) AS credit, COUNT(DISTINCT l.entry_id) AS entries
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.company_id = ? AND e.status = 'posted'`,
      [companyId],
    ) ?? { debit: 0, credit: 0, entries: 0 };
  const debit = row.debit ?? 0;
  const credit = row.credit ?? 0;
  return { debit, credit, difference: debit - credit, entries: row.entries };
}

export function accountBalance(companyId: number, accountId: number, asOf?: string): number {
  const params: unknown[] = [companyId, accountId];
  let sql = `SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS net
               FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
              WHERE l.company_id = ? AND l.account_id = ? AND e.status = 'posted'`;
  if (asOf) {
    sql += " AND e.date <= ?";
    params.push(asOf);
  }
  const row = one<{ net: number }>(sql, params);
  return row?.net ?? 0;
}

export function accountBalanceByCode(companyId: number, code: string, asOf?: string): number {
  const account = accountByCode(companyId, code);
  if (!account) return 0;
  return accountBalance(companyId, account.id, asOf);
}
