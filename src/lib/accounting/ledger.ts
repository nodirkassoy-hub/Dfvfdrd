/**
 * BUXAI reporting layer.
 *
 * Every function in this file reads `journal_lines` (through `journal_entries`)
 * and nothing else. Dashboards, reports, the AI Center, Xato Radar and the
 * month-end close all consume these functions, which is what guarantees that
 * one figure is identical everywhere it appears.
 */
import { all, one } from "@/lib/db";
import { monthKey, monthRange } from "@/lib/dates";
import type { AccountType } from "./coa";

export type AccountRef = {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  parent_id: number | null;
};

export type BalanceRow = {
  account: AccountRef;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
};

const POSTED = "e.status = 'posted'";

function accountList(companyId: number): AccountRef[] {
  return all<AccountRef>(
    `SELECT id, code, name, type, subtype, parent_id FROM accounts
      WHERE company_id = ? AND is_archived = 0 ORDER BY code`,
    [companyId],
  );
}

export function accountsWithBalances(companyId: number, asOf?: string): (AccountRef & { balance: number })[] {
  const params: unknown[] = [companyId];
  let dateFilter = "";
  if (asOf) {
    dateFilter = " AND e.date <= ?";
    params.push(asOf);
  }
  const rows = all<{ account_id: number; net: number }>(
    `SELECT l.account_id AS account_id, COALESCE(SUM(l.base_debit - l.base_credit), 0) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.company_id = ? AND ${POSTED}${dateFilter}
      GROUP BY l.account_id`,
    params,
  );
  const map = new Map(rows.map((r) => [r.account_id, r.net]));
  return accountList(companyId).map((account) => ({ ...account, balance: map.get(account.id) ?? 0 }));
}

/** Sum of balances for all accounts of a given type / subtype / code prefix. */
export function sumByType(companyId: number, asOf?: string): Record<AccountType, number> {
  const params: unknown[] = [companyId];
  let dateFilter = "";
  if (asOf) {
    dateFilter = " AND e.date <= ?";
    params.push(asOf);
  }
  const rows = all<{ type: AccountType; net: number }>(
    `SELECT a.type AS type, COALESCE(SUM(l.base_debit - l.base_credit), 0) AS net
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND ${POSTED}${dateFilter}
      GROUP BY a.type`,
    params,
  );
  const out: Record<AccountType, number> = {
    asset: 0,
    liability: 0,
    equity: 0,
    revenue: 0,
    cogs: 0,
    expense: 0,
    other_income: 0,
    other_expense: 0,
  };
  for (const row of rows) out[row.type] = row.net;
  return out;
}

/* ------------------------------------------------------------ trial balance */
export type TrialBalance = {
  rows: BalanceRow[];
  totals: { openingDebit: number; openingCredit: number; debit: number; credit: number; closingDebit: number; closingCredit: number };
  balanced: boolean;
};

export function trialBalance(companyId: number, from: string, to: string): TrialBalance {
  const rows = all<{
    id: number;
    code: string;
    name: string;
    type: AccountType;
    subtype: string | null;
    parent_id: number | null;
    opening: number;
    debit: number;
    credit: number;
  }>(
    `SELECT a.id, a.code, a.name, a.type, a.subtype, a.parent_id,
            COALESCE(SUM(CASE WHEN e.date < ? THEN l.base_debit - l.base_credit ELSE 0 END), 0) AS opening,
            COALESCE(SUM(CASE WHEN e.date BETWEEN ? AND ? THEN l.base_debit ELSE 0 END), 0) AS debit,
            COALESCE(SUM(CASE WHEN e.date BETWEEN ? AND ? THEN l.base_credit ELSE 0 END), 0) AS credit
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND ${POSTED}
      GROUP BY a.id
      ORDER BY a.code`,
    [from, from, to, from, to, companyId],
  );

  const mapping = rows.map((row) => {
    const account: AccountRef = {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      subtype: row.subtype,
      parent_id: row.parent_id,
    };
    return {
      account,
      opening: row.opening,
      debit: row.debit,
      credit: row.credit,
      closing: row.opening + row.debit - row.credit,
    };
  });

  const totals = mapping.reduce(
    (acc, row) => {
      acc.openingDebit += Math.max(row.opening, 0);
      acc.openingCredit += Math.max(-row.opening, 0);
      acc.debit += row.debit;
      acc.credit += row.credit;
      acc.closingDebit += Math.max(row.closing, 0);
      acc.closingCredit += Math.max(-row.closing, 0);
      return acc;
    },
    { openingDebit: 0, openingCredit: 0, debit: 0, credit: 0, closingDebit: 0, closingCredit: 0 },
  );

  return {
    rows: mapping,
    totals,
    balanced: totals.debit === totals.credit && totals.closingDebit === totals.closingCredit,
  };
}

/* --------------------------------------------------------------- P&L / IS */
export type IncomeStatementLine = {
  accountId: number;
  code: string;
  name: string;
  subtype: string | null;
  amount: number;
  previous: number;
  changePct: number | null;
};

export type IncomeStatementSection = {
  key: string;
  label: string;
  total: number;
  previousTotal: number;
  lines: IncomeStatementLine[];
};

export type IncomeStatement = {
  from: string;
  to: string;
  revenue: IncomeStatementSection;
  cogs: IncomeStatementSection;
  grossProfit: number;
  grossProfitPrevious: number;
  operatingExpenses: IncomeStatementSection;
  operatingProfit: number;
  operatingProfitPrevious: number;
  otherIncome: IncomeStatementSection;
  otherExpenses: IncomeStatementSection;
  netProfit: number;
  netProfitPrevious: number;
  ebitda: number;
  margins: {
    gross: number | null;
    operating: number | null;
    net: number | null;
  };
};

type RawGroupRow = {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  current: number;
  previous: number;
};

function pct(current: number, previous: number): number | null {
  if (!previous) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function incomeStatement(companyId: number, from: string, to: string, previousFrom: string, previousTo: string): IncomeStatement {
  const rows = all<RawGroupRow>(
    `SELECT a.id, a.code, a.name, a.type, a.subtype,
        COALESCE(SUM(CASE WHEN e.date BETWEEN ? AND ? THEN l.base_debit - l.base_credit ELSE 0 END), 0) AS current,
        COALESCE(SUM(CASE WHEN e.date BETWEEN ? AND ? THEN l.base_debit - l.base_credit ELSE 0 END), 0) AS previous
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ?
        AND ${POSTED}
        AND a.type IN ('revenue','cogs','expense','other_income','other_expense')
        AND (e.date BETWEEN ? AND ? OR e.date BETWEEN ? AND ?)
      GROUP BY a.id
      ORDER BY a.code`,
    [from, to, previousFrom, previousTo, companyId, from, to, previousFrom, previousTo],
  );

  const build = (key: string, label: string, types: AccountType[], sign: 1 | -1): IncomeStatementSection => {
    const filtered = rows
      .filter((row) => types.includes(row.type))
      .map<IncomeStatementLine>((row) => {
        const amount = sign * row.current;
        const previous = sign * row.previous;
        return {
          accountId: row.id,
          code: row.code,
          name: row.name,
          subtype: row.subtype,
          amount,
          previous,
          changePct: pct(amount, previous),
        };
      })
      .filter((line) => line.amount !== 0 || line.previous !== 0);
    return {
      key,
      label,
      total: filtered.reduce((sum, line) => sum + line.amount, 0),
      previousTotal: filtered.reduce((sum, line) => sum + line.previous, 0),
      lines: filtered,
    };
  };

  const revenue = build("revenue", "Revenue", ["revenue"], -1);
  const cogs = build("cogs", "Cost of goods sold", ["cogs"], 1);
  const operatingExpenses = build("opex", "Operating expenses", ["expense"], 1);
  const otherIncome = build("other_income", "Other income", ["other_income"], -1);
  const otherExpenses = build("other_expense", "Other expenses", ["other_expense"], 1);

  const grossProfit = revenue.total - cogs.total;
  const grossProfitPrevious = revenue.previousTotal - cogs.previousTotal;
  const operatingProfit = grossProfit - operatingExpenses.total;
  const operatingProfitPrevious = grossProfitPrevious - operatingExpenses.previousTotal;
  const netProfit = operatingProfit + otherIncome.total - otherExpenses.total;
  const netProfitPrevious = operatingProfitPrevious + otherIncome.previousTotal - otherExpenses.previousTotal;

  return {
    from,
    to,
    revenue,
    cogs,
    grossProfit,
    grossProfitPrevious,
    operatingExpenses,
    operatingProfit,
    operatingProfitPrevious,
    otherIncome,
    otherExpenses,
    netProfit,
    netProfitPrevious,
    ebitda: netProfit,
    margins: {
      gross: revenue.total ? (grossProfit / revenue.total) * 100 : null,
      operating: revenue.total ? (operatingProfit / revenue.total) * 100 : null,
      net: revenue.total ? (netProfit / revenue.total) * 100 : null,
    },
  };
}

/* ------------------------------------------------------------ balance sheet */
export type BalanceSheetGroup = {
  key: string;
  label: string;
  total: number;
  lines: { accountId: number; code: string; name: string; subtype: string | null; amount: number }[];
};

export type BalanceSheet = {
  asOf: string;
  currentAssets: BalanceSheetGroup;
  nonCurrentAssets: BalanceSheetGroup;
  totalAssets: number;
  currentLiabilities: BalanceSheetGroup;
  nonCurrentLiabilities: BalanceSheetGroup;
  totalLiabilities: number;
  equity: BalanceSheetGroup;
  currentYearResult: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  balanced: boolean;
  difference: number;
};

const CURRENT_ASSET_SUBTYPES = new Set(["cash", "bank", "receivable", "inventory", "prepaid", "tax", "current", null]);

export function balanceSheet(companyId: number, asOf: string, fiscalYearStart: string): BalanceSheet {
  const balances = accountsWithBalances(companyId, asOf);
  const ytd = incomeStatement(companyId, fiscalYearStart, asOf, fiscalYearStart, asOf);

  const toGroup = (key: string, label: string, predicate: (a: AccountRef) => boolean, sign: 1 | -1): BalanceSheetGroup => {
    const lines = balances
      .filter((account) => predicate(account) && account.balance !== 0)
      .map((account) => ({
        accountId: account.id,
        code: account.code,
        name: account.name,
        subtype: account.subtype,
        amount: sign * account.balance,
      }))
      .filter((line) => line.amount !== 0);
    return { key, label, total: lines.reduce((sum, line) => sum + line.amount, 0), lines };
  };

  const currentAssets = toGroup("current_assets", "Current assets", (a) => a.type === "asset" && CURRENT_ASSET_SUBTYPES.has(a.subtype), 1);
  const nonCurrentAssets = toGroup("non_current_assets", "Non-current assets", (a) => a.type === "asset" && !CURRENT_ASSET_SUBTYPES.has(a.subtype), 1);

  const currentLiabilities = toGroup("current_liabilities", "Current liabilities", (a) => a.type === "liability" && a.subtype !== "loan", -1);
  const nonCurrentLiabilities = toGroup("non_current_liabilities", "Long-term liabilities", (a) => a.type === "liability" && a.subtype === "loan", -1);

  const equity = toGroup("equity", "Equity", (a) => a.type === "equity" && a.subtype !== "drawings", -1);
  const drawings = toGroup("drawings", "Owner's drawings", (a) => a.type === "equity" && a.subtype === "drawings", -1);

  const totalAssets = currentAssets.total + nonCurrentAssets.total;
  const totalLiabilities = currentLiabilities.total + nonCurrentLiabilities.total;
  const equityBase = equity.total + drawings.total;
  const totalEquity = equityBase + ytd.netProfit;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

  return {
    asOf,
    currentAssets,
    nonCurrentAssets,
    totalAssets,
    currentLiabilities,
    nonCurrentLiabilities,
    totalLiabilities,
    equity: { ...equity, total: equityBase, lines: [...equity.lines, ...drawings.lines] },
    currentYearResult: ytd.netProfit,
    totalEquity,
    totalLiabilitiesAndEquity,
    balanced: totalAssets === totalLiabilitiesAndEquity,
    difference: totalAssets - totalLiabilitiesAndEquity,
  };
}

/* ------------------------------------------------------------- cash accounts */
export function cashAccountIds(companyId: number): number[] {
  return all<{ id: number }>(
    "SELECT id FROM accounts WHERE company_id = ? AND subtype IN ('cash','bank') AND is_archived = 0",
    [companyId],
  ).map((row) => row.id);
}

export function cashBalance(companyId: number, asOf?: string): number {
  const params: unknown[] = [companyId];
  let dateFilter = "";
  if (asOf) {
    dateFilter = " AND e.date <= ?";
    params.push(asOf);
  }
  const row = one<{ net: number }>(
    `SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS net
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND a.subtype IN ('cash','bank') AND ${POSTED}${dateFilter}`,
    params,
  );
  return row?.net ?? 0;
}

export function cashMovement(companyId: number, from: string, to: string): { inflow: number; outflow: number; net: number } {
  const row = one<{ inflow: number; outflow: number }>(
    `SELECT COALESCE(SUM(CASE WHEN l.base_debit > l.base_credit THEN l.base_debit - l.base_credit ELSE 0 END), 0) AS inflow,
            COALESCE(SUM(CASE WHEN l.base_credit > l.base_debit THEN l.base_credit - l.base_debit ELSE 0 END), 0) AS outflow
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND a.subtype IN ('cash','bank') AND ${POSTED} AND e.date BETWEEN ? AND ?`,
    [companyId, from, to],
  );
  const inflow = row?.inflow ?? 0;
  const outflow = row?.outflow ?? 0;
  return { inflow, outflow, net: inflow - outflow };
}

/* ---------------------------------------------------------- cash flow (IAS7) */
export type CashFlowSection = { key: string; label: string; total: number; items: { label: string; amount: number }[] };

export type CashFlowStatement = {
  from: string;
  to: string;
  opening: number;
  closing: number;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChange: number;
  reconciles: boolean;
};

export function cashFlowStatement(companyId: number, from: string, to: string): CashFlowStatement {
  const rows = all<{
    entry_id: number;
    account_id: number;
    type: AccountType;
    subtype: string | null;
    code: string;
    name: string;
    base_debit: number;
    base_credit: number;
  }>(
    `SELECT l.entry_id, l.account_id, a.type, a.subtype, a.code, a.name, l.base_debit, l.base_credit
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND ${POSTED} AND e.date BETWEEN ? AND ?
      ORDER BY l.entry_id, l.line_no`,
    [companyId, from, to],
  );

  const byEntry = new Map<number, typeof rows>();
  for (const row of rows) {
    const bucket = byEntry.get(row.entry_id);
    if (bucket) bucket.push(row);
    else byEntry.set(row.entry_id, [row]);
  }

  const operating = new Map<string, number>();
  const investing = new Map<string, number>();
  const financing = new Map<string, number>();

  const classify = (line: { type: AccountType; subtype: string | null; code: string }): "operating" | "investing" | "financing" => {
    if (line.type === "asset" && ["fixed_asset", "intangible", "other"].includes(line.subtype ?? "")) return "investing";
    if (line.type === "liability" && line.subtype === "loan") return "financing";
    if (line.type === "equity") return "financing";
    return "operating";
  };

  for (const [, lines] of byEntry) {
    const cashLines = lines.filter((line) => line.subtype === "cash" || line.subtype === "bank");
    if (cashLines.length === 0) continue;
    const cashNet = cashLines.reduce((sum, line) => sum + (line.base_debit - line.base_credit), 0);
    if (cashNet === 0) continue;
    const counterparts = lines.filter((line) => !(line.subtype === "cash" || line.subtype === "bank"));
    if (counterparts.length === 0) continue;

    const totalCounter = counterparts.reduce((sum, line) => sum + (line.base_debit - line.base_credit), 0);
    for (const line of counterparts) {
      const share = totalCounter === 0 ? 0 : ((line.base_debit - line.base_credit) / totalCounter) * cashNet;
      const rounded = Math.round(share);
      if (rounded === 0) continue;
      const target = classify(line);
      const map = target === "investing" ? investing : target === "financing" ? financing : operating;
      const label = `${line.code} ${line.name}`;
      map.set(label, (map.get(label) ?? 0) + rounded);
    }
  }

  const toSection = (key: string, label: string, map: Map<string, number>): CashFlowSection => {
    const items = [...map.entries()]
      .map(([itemLabel, amount]) => ({ label: itemLabel, amount }))
      .filter((item) => item.amount !== 0)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return { key, label, total: items.reduce((sum, item) => sum + item.amount, 0), items };
  };

  const opening = cashBalance(companyId, monthKeyAddDays(from, -1));
  const closing = cashBalance(companyId, to);
  const operatingSection = toSection("operating", "Operating activities", operating);
  const investingSection = toSection("investing", "Investing activities", investing);
  const financingSection = toSection("financing", "Financing activities", financing);
  const netChange = operatingSection.total + investingSection.total + financingSection.total;

  return {
    from,
    to,
    opening,
    closing,
    operating: operatingSection,
    investing: investingSection,
    financing: financingSection,
    netChange,
    reconciles: opening + netChange === closing,
  };
}

function monthKeyAddDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ---------------------------------------------------------- general ledger */
export type LedgerLine = {
  entryId: number;
  entryNumber: string;
  date: string;
  memo: string | null;
  reference: string | null;
  sourceType: string;
  sourceId: number | null;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
  contactType: string | null;
  contactId: number | null;
  contactName: string | null;
  docType: string | null;
  docId: number | null;
};

export function generalLedger(
  companyId: number,
  accountId: number,
  from: string,
  to: string,
): { opening: number; lines: LedgerLine[]; closing: number; debit: number; credit: number } {
  const openingRow = one<{ net: number }>(
    `SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.company_id = ? AND l.account_id = ? AND ${POSTED} AND e.date < ?`,
    [companyId, accountId, from],
  );
  let opening = openingRow?.net ?? 0;

  const raw = all<Omit<LedgerLine, "balance" | "contactName">>(
    `SELECT e.id AS entryId, e.number AS entryNumber, e.date AS date, e.memo AS memo, e.reference AS reference,
            e.source_type AS sourceType, e.source_id AS sourceId, l.description AS description,
            l.base_debit AS debit, l.base_credit AS credit, l.contact_type AS contactType, l.contact_id AS contactId,
            l.doc_type AS docType, l.doc_id AS docId
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.company_id = ? AND l.account_id = ? AND ${POSTED} AND e.date BETWEEN ? AND ?
      ORDER BY e.date, e.id, l.line_no`,
    [companyId, accountId, from, to],
  );

  const contactIds = [...new Set(raw.map((line) => line.contactId).filter((id): id is number => typeof id === "number"))];
  const nameMap = new Map<number, string>();
  if (contactIds.length) {
    const placeholders = contactIds.map(() => "?").join(",");
    for (const row of all<{ id: number; name: string }>(`SELECT id, name FROM contacts WHERE id IN (${placeholders})`, contactIds)) {
      nameMap.set(row.id, row.name);
    }
  }

  let debit = 0;
  let credit = 0;
  const lines = raw.map<LedgerLine>((line) => {
    debit += line.debit;
    credit += line.credit;
    opening += line.debit - line.credit;
    return { ...line, balance: opening, contactName: line.contactId ? (nameMap.get(line.contactId) ?? null) : null };
  });

  return { opening: opening - debit + credit, lines, closing: opening, debit, credit };
}

/* ------------------------------------------------------------- drill-down */
export type DrillDownLine = {
  entryId: number;
  entryNumber: string;
  date: string;
  accountId: number;
  accountCode: string;
  accountName: string;
  description: string | null;
  debit: number;
  credit: number;
  contactId: number | null;
  contactName: string | null;
  sourceType: string;
  sourceId: number | null;
  docType: string | null;
  docId: number | null;
  amount: number;
};

/**
 * The drill-down used by every clickable figure in the product: given a set of
 * accounts and a period, list the exact journal lines that produced the number,
 * with a link back to the originating document.
 */
export function drillDown(
  companyId: number,
  options: { accountIds?: number[]; types?: AccountType[]; from: string; to: string; contactId?: number; limit?: number },
): DrillDownLine[] {
  const conditions = ["l.company_id = ?", POSTED, "e.date BETWEEN ? AND ?"];
  const params: unknown[] = [companyId, options.from, options.to];

  if (options.accountIds?.length) {
    conditions.push(`l.account_id IN (${options.accountIds.map(() => "?").join(",")})`);
    params.push(...options.accountIds);
  }
  if (options.types?.length) {
    conditions.push(`a.type IN (${options.types.map(() => "?").join(",")})`);
    params.push(...options.types);
  }
  if (options.contactId) {
    conditions.push("l.contact_id = ?");
    params.push(options.contactId);
  }

  const limit = options.limit ?? 500;
  const rows = all<DrillDownLine & { debit: number; credit: number }>(
    `SELECT e.id AS entryId, e.number AS entryNumber, e.date AS date, l.account_id AS accountId,
            a.code AS accountCode, a.name AS accountName, l.description AS description,
            l.base_debit AS debit, l.base_credit AS credit, l.contact_id AS contactId,
            e.source_type AS sourceType, e.source_id AS sourceId, l.doc_type AS docType, l.doc_id AS docId
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY e.date DESC, e.id DESC, l.line_no
      LIMIT ?`,
    [...params, limit],
  );

  const contactIds = [...new Set(rows.map((row) => row.contactId).filter((id): id is number => typeof id === "number"))];
  const nameMap = new Map<number, string>();
  if (contactIds.length) {
    const placeholders = contactIds.map(() => "?").join(",");
    for (const row of all<{ id: number; name: string }>(`SELECT id, name FROM contacts WHERE id IN (${placeholders})`, contactIds)) {
      nameMap.set(row.id, row.name);
    }
  }

  return rows.map((row) => ({
    ...row,
    contactName: row.contactId ? (nameMap.get(row.contactId) ?? null) : null,
    amount: row.debit - row.credit,
  }));
}

export function accountIdsForTypes(companyId: number, types: AccountType[]): number[] {
  if (!types.length) return [];
  return all<{ id: number }>(
    `SELECT id FROM accounts WHERE company_id = ? AND type IN (${types.map(() => "?").join(",")})`,
    [companyId, ...types],
  ).map((row) => row.id);
}

/* -------------------------------------------------------- aging / balances */
export type AgingRow = {
  contactId: number;
  contactName: string;
  currency: string;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
  documents: number;
  ledgerBalance: number;
  difference: number;
};

function agingFromDocuments(
  companyId: number,
  table: "invoices" | "bills",
  asOf: string,
): AgingRow[] {
  const rows = all<{
    contact_id: number;
    contact_name: string;
    currency: string;
    outstanding: number;
    due_date: string;
    documents: number;
  }>(
    `SELECT d.contact_id AS contact_id, c.name AS contact_name, d.currency AS currency,
            SUM(d.total - d.amount_paid) AS outstanding, d.due_date AS due_date, COUNT(*) AS documents
       FROM ${table} d
       JOIN contacts c ON c.id = d.contact_id
      WHERE d.company_id = ?
        AND d.status NOT IN ('draft','cancelled')
        AND d.total > d.amount_paid
        AND d.issue_date <= ?
      GROUP BY d.contact_id, d.due_date, d.currency`,
    [companyId, asOf],
  );

  const ledgerRows = all<{ contact_id: number; net: number }>(
    `SELECT l.contact_id AS contact_id, COALESCE(SUM(l.base_debit - l.base_credit), 0) AS net
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND ${POSTED} AND e.date <= ?
        AND a.subtype = 'receivable' AND a.code = ?
        AND l.contact_type = 'customer'
      GROUP BY l.contact_id`,
    [companyId, asOf, table === "invoices" ? "1101" : "1101"],
  );
  const ledgerMap = new Map(ledgerRows.map((row) => [row.contact_id, row.net]));

  const map = new Map<number, AgingRow>();
  const today = asOf;
  for (const row of rows) {
    const outstanding = row.outstanding;
    const overdueDays = Math.floor((Date.parse(today) - Date.parse(row.due_date)) / 86_400_000);
    const existing =
      map.get(row.contact_id) ??
      ({
        contactId: row.contact_id,
        contactName: row.contact_name,
        currency: row.currency,
        current: 0,
        d1_30: 0,
        d31_60: 0,
        d61_90: 0,
        d90_plus: 0,
        total: 0,
        documents: 0,
        ledgerBalance: 0,
        difference: 0,
      } satisfies AgingRow);

    if (overdueDays <= 0) existing.current += outstanding;
    else if (overdueDays <= 30) existing.d1_30 += outstanding;
    else if (overdueDays <= 60) existing.d31_60 += outstanding;
    else if (overdueDays <= 90) existing.d61_90 += outstanding;
    else existing.d90_plus += outstanding;

    existing.total += outstanding;
    existing.documents += row.documents;
    map.set(row.contact_id, existing);
  }

  const result = [...map.values()];
  for (const row of result) {
    const ledger = Math.abs(ledgerMap.get(row.contactId) ?? 0);
    row.ledgerBalance = ledger;
    row.difference = ledger - row.total;
  }
  return result.sort((a, b) => b.total - a.total);
}

export function receivablesAging(companyId: number, asOf: string): AgingRow[] {
  return agingFromDocuments(companyId, "invoices", asOf);
}

export function payablesAging(companyId: number, asOf: string): AgingRow[] {
  // Bills are liabilities: the ledger balance for a supplier is credit-side.
  const rows = agingFromDocuments(companyId, "bills", asOf);
  const ledgerRows = all<{ contact_id: number; net: number }>(
    `SELECT l.contact_id AS contact_id, COALESCE(SUM(l.base_credit - l.base_debit), 0) AS net
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND ${POSTED} AND e.date <= ?
        AND a.code = '2011' AND l.contact_type = 'supplier'
      GROUP BY l.contact_id`,
    [companyId, asOf],
  );
  const ledgerMap = new Map(ledgerRows.map((row) => [row.contact_id, row.net]));
  for (const row of rows) {
    const ledger = Math.abs(ledgerMap.get(row.contactId) ?? 0);
    row.ledgerBalance = ledger;
    row.difference = ledger - row.total;
  }
  return rows;
}

export function accountsReceivable(companyId: number, asOf: string): number {
  const row = one<{ net: number }>(
    `SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND a.type = 'asset' AND a.subtype = 'receivable' AND a.code = '1101'
        AND ${POSTED} AND e.date <= ?`,
    [companyId, asOf],
  );
  return row?.net ?? 0;
}

export function accountsPayable(companyId: number, asOf: string): number {
  const row = one<{ net: number }>(
    `SELECT COALESCE(SUM(l.base_credit - l.base_debit), 0) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND a.code = '2011' AND ${POSTED} AND e.date <= ?`,
    [companyId, asOf],
  );
  return row?.net ?? 0;
}

/* ----------------------------------------------------------- analytics */
export type MonthlyPoint = {
  month: string;
  revenue: number;
  expenses: number;
  cogs: number;
  netProfit: number;
  cashIn: number;
  cashOut: number;
  cashNet: number;
};

export function monthlySeries(companyId: number, from: string, to: string): MonthlyPoint[] {
  const rows = all<{ month: string; type: AccountType; net: number }>(
    `SELECT substr(e.date, 1, 7) AS month, a.type AS type,
            COALESCE(SUM(l.base_debit - l.base_credit), 0) AS net
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND ${POSTED} AND e.date BETWEEN ? AND ?
        AND a.type IN ('revenue','cogs','expense','other_income','other_expense')
      GROUP BY month, a.type`,
    [companyId, from, to],
  );

  const cashRows = all<{ month: string; inflow: number; outflow: number }>(
    `SELECT substr(e.date, 1, 7) AS month,
            COALESCE(SUM(CASE WHEN l.base_debit > l.base_credit THEN l.base_debit - l.base_credit ELSE 0 END), 0) AS inflow,
            COALESCE(SUM(CASE WHEN l.base_credit > l.base_debit THEN l.base_credit - l.base_debit ELSE 0 END), 0) AS outflow
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND a.subtype IN ('cash','bank') AND ${POSTED} AND e.date BETWEEN ? AND ?
      GROUP BY month`,
    [companyId, from, to],
  );
  const cashMap = new Map(cashRows.map((row) => [row.month, row]));

  const months = monthRange(from, to);
  const index = new Map<string, MonthlyPoint>();
  for (const month of months) {
    index.set(month, { month, revenue: 0, expenses: 0, cogs: 0, netProfit: 0, cashIn: 0, cashOut: 0, cashNet: 0 });
  }
  for (const row of rows) {
    const point = index.get(row.month);
    if (!point) continue;
    if (row.type === "revenue") point.revenue += -row.net;
    else if (row.type === "cogs") point.cogs += row.net;
    else if (row.type === "expense") point.expenses += row.net;
    else if (row.type === "other_income") point.netProfit += -row.net;
    else if (row.type === "other_expense") point.netProfit -= row.net;
    point.netProfit += 0; // profit is recalculated below from all components
  }
  for (const point of index.values()) {
    point.netProfit = point.revenue - point.cogs - point.expenses + point.netProfit;
    const cash = cashMap.get(point.month);
    point.cashIn = cash?.inflow ?? 0;
    point.cashOut = cash?.outflow ?? 0;
    point.cashNet = point.cashIn - point.cashOut;
  }
  return months.map((month) => index.get(month)!);
}

export type BreakdownRow = {
  key: string;
  label: string;
  amount: number;
  previous: number;
  changePct: number | null;
  share: number;
  accountId: number | null;
  categoryId: number | null;
};

export function expenseBreakdown(
  companyId: number,
  from: string,
  to: string,
  previousFrom: string,
  previousTo: string,
): BreakdownRow[] {
  const rows = all<{
    account_id: number;
    code: string;
    name: string;
    current: number;
    previous: number;
  }>(
    `SELECT a.id AS account_id, a.code, a.name,
            COALESCE(SUM(CASE WHEN e.date BETWEEN ? AND ? THEN l.base_debit - l.base_credit ELSE 0 END), 0) AS current,
            COALESCE(SUM(CASE WHEN e.date BETWEEN ? AND ? THEN l.base_debit - l.base_credit ELSE 0 END), 0) AS previous
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND ${POSTED} AND a.type IN ('cogs','expense','other_expense')
        AND (e.date BETWEEN ? AND ? OR e.date BETWEEN ? AND ?)
      GROUP BY a.id
      HAVING current <> 0 OR previous <> 0
      ORDER BY current DESC`,
    [from, to, previousFrom, previousTo, companyId, from, to, previousFrom, previousTo],
  );
  const total = rows.reduce((sum, row) => sum + row.current, 0);
  return rows.map((row) => ({
    key: row.code,
    label: `${row.code} · ${row.name}`,
    amount: row.current,
    previous: row.previous,
    changePct: pct(row.current, row.previous),
    share: total ? (row.current / total) * 100 : 0,
    accountId: row.account_id,
    categoryId: null,
  }));
}

export function revenueBreakdown(
  companyId: number,
  from: string,
  to: string,
  previousFrom: string,
  previousTo: string,
): BreakdownRow[] {
  const rows = all<{ account_id: number; code: string; name: string; current: number; previous: number }>(
    `SELECT a.id AS account_id, a.code, a.name,
            COALESCE(SUM(CASE WHEN e.date BETWEEN ? AND ? THEN l.base_credit - l.base_debit ELSE 0 END), 0) AS current,
            COALESCE(SUM(CASE WHEN e.date BETWEEN ? AND ? THEN l.base_credit - l.base_debit ELSE 0 END), 0) AS previous
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND ${POSTED} AND a.type IN ('revenue','other_income')
        AND (e.date BETWEEN ? AND ? OR e.date BETWEEN ? AND ?)
      GROUP BY a.id
      HAVING current <> 0 OR previous <> 0
      ORDER BY current DESC`,
    [from, to, previousFrom, previousTo, companyId, from, to, previousFrom, previousTo],
  );
  const total = rows.reduce((sum, row) => sum + row.current, 0);
  return rows.map((row) => ({
    key: row.code,
    label: `${row.code} · ${row.name}`,
    amount: row.current,
    previous: row.previous,
    changePct: pct(row.current, row.previous),
    share: total ? (row.current / total) * 100 : 0,
    accountId: row.account_id,
    categoryId: null,
  }));
}

export type ContactRank = {
  contactId: number;
  name: string;
  revenue: number;
  previousRevenue: number;
  invoices: number;
  changePct: number | null;
  outstanding: number;
};

export function topContactsByRevenue(
  companyId: number,
  from: string,
  to: string,
  previousFrom: string,
  previousTo: string,
  limit = 8,
): ContactRank[] {
  const rows = all<{ contact_id: number; name: string; revenue: number; previous_revenue: number; invoices: number }>(
    `SELECT l.contact_id AS contact_id, c.name AS name,
            COALESCE(SUM(CASE WHEN e.date BETWEEN ? AND ? THEN l.base_credit - l.base_debit ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(CASE WHEN e.date BETWEEN ? AND ? THEN l.base_credit - l.base_debit ELSE 0 END), 0) AS previous_revenue,
            COUNT(DISTINCT CASE WHEN e.date BETWEEN ? AND ? THEN e.id END) AS invoices
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
       JOIN contacts c ON c.id = l.contact_id
      WHERE l.company_id = ? AND ${POSTED} AND a.type = 'revenue' AND l.contact_type = 'customer'
        AND (e.date BETWEEN ? AND ? OR e.date BETWEEN ? AND ?)
      GROUP BY l.contact_id
      HAVING revenue <> 0 OR previous_revenue <> 0
      ORDER BY revenue DESC
      LIMIT ?`,
    [from, to, previousFrom, previousTo, from, to, companyId, from, to, previousFrom, previousTo, limit],
  );

  const outstanding = all<{ contact_id: number; outstanding: number }>(
    `SELECT contact_id, SUM(total - amount_paid) AS outstanding FROM invoices
      WHERE company_id = ? AND status NOT IN ('draft','cancelled') AND total > amount_paid
      GROUP BY contact_id`,
    [companyId],
  );
  const outstandingMap = new Map(outstanding.map((row) => [row.contact_id, row.outstanding]));

  return rows.map((row) => ({
    contactId: row.contact_id,
    name: row.name,
    revenue: row.revenue,
    previousRevenue: row.previous_revenue,
    invoices: row.invoices,
    changePct: pct(row.revenue, row.previous_revenue),
    outstanding: outstandingMap.get(row.contact_id) ?? 0,
  }));
}

export function totalDebitsAndCredits(companyId: number, from: string, to: string): { debit: number; credit: number; entries: number } {
  const row = one<{ debit: number; credit: number; entries: number }>(
    `SELECT COALESCE(SUM(l.base_debit),0) AS debit, COALESCE(SUM(l.base_credit),0) AS credit, COUNT(DISTINCT e.id) AS entries
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.company_id = ? AND ${POSTED} AND e.date BETWEEN ? AND ?`,
    [companyId, from, to],
  );
  return row ?? { debit: 0, credit: 0, entries: 0 };
}

export { monthKey, pct };
