/**
 * Operations layer: Xato Radar (risk detection), My Work tasks, notifications,
 * month-end close and budgets.
 *
 * Every detector reads posted ledger data and existing documents; each finding
 * states what happened, why it matters, the financial impact, how to fix it and
 * how confident the detector is. Findings are stable: a fingerprint identifies
 * the same issue across runs, so resolved items stay resolved.
 */
import { all, insert, nowISO, one, run, tx } from "@/lib/db";
import { accountsPayable, accountsReceivable, expenseBreakdown, incomeStatement, receivablesAging, trialBalance } from "@/lib/accounting/ledger";
import { todayISO, addDays, endOfMonth, resolvePeriod, monthKey, diffDays, type Period } from "@/lib/dates";
import { recordAudit } from "./company";
import { suggestCategory } from "./documents";

export type Ctx = { userId?: number | null; userName?: string | null };

/* ------------------------------------------------------------ xato radar */
export type AlertSeverity = "low" | "medium" | "high" | "critical";

export type AlertCandidate = {
  type: string;
  severity: AlertSeverity;
  title: string;
  whatHappened: string;
  whyProblem: string;
  impactAmount: number;
  howToFix: string;
  confidenceBp: number;
  fingerprint: string;
  relatedType?: string | null;
  relatedId?: number | null;
  meta?: Record<string, unknown>;
};

function fmt(amount: number): string {
  return amount.toLocaleString("en-US");
}

export function detectLedgerImbalance(companyId: number): AlertCandidate[] {
  const row = one<{ debit: number; credit: number }>(
    `SELECT COALESCE(SUM(l.base_debit),0) AS debit, COALESCE(SUM(l.base_credit),0) AS credit
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.company_id = ? AND e.status = 'posted'`,
    [companyId],
  );
  const difference = (row?.debit ?? 0) - (row?.credit ?? 0);
  if (difference === 0) return [];
  return [
    {
      type: "ledger_imbalance",
      severity: "critical",
      title: "The ledger is not balanced",
      whatHappened: `Total debits (${fmt(row?.debit ?? 0)}) do not equal total credits (${fmt(row?.credit ?? 0)}).`,
      whyProblem:
        "Every report in BUXAI is derived from the ledger. If the ledger does not balance, the balance sheet, profit and tax figures cannot be trusted.",
      impactAmount: Math.abs(difference),
      howToFix:
        "Open Accounting → Trial balance, find the account with the suspicious movement, and post a correcting entry. BUXAI blocks unbalanced entries, so this usually means data was changed directly in the database.",
      confidenceBp: 9900,
      fingerprint: `ledger_imbalance:${difference}`,
    },
  ];
}

export function detectReceivableMismatch(companyId: number, asOf = todayISO()): AlertCandidate[] {
  const ledger = Math.abs(accountsReceivable(companyId, asOf));
  const aging = receivablesAging(companyId, asOf);
  const documents = aging.reduce((sum, row) => sum + row.total, 0);
  const difference = ledger - documents;
  if (Math.abs(difference) < 100_00) return [];
  return [
    {
      type: "invoice_mismatch",
      severity: "high",
      title: "Invoice balances and the ledger disagree",
      whatHappened: `Unpaid invoices total ${fmt(documents)} while account 1101 (trade receivables) shows ${fmt(ledger)} — a difference of ${fmt(difference)}.`,
      whyProblem:
        "Receivables reports read the invoice list, while the balance sheet reads the ledger. A difference means one of them is understating what customers owe.",
      impactAmount: Math.abs(difference),
      howToFix:
        "Check invoices that were edited, cancelled or paid in the period, and look for advances customers paid that were posted directly to revenue instead of receivables.",
      confidenceBp: 9200,
      fingerprint: `receivable_mismatch:${difference}`,
    },
  ];
}

export function detectPayableMismatch(companyId: number, asOf = todayISO()): AlertCandidate[] {
  const ledger = Math.abs(accountsPayable(companyId, asOf));
  const row = one<{ outstanding: number }>(
    `SELECT COALESCE(SUM(total - amount_paid), 0) AS outstanding FROM bills
      WHERE company_id = ? AND status NOT IN ('cancelled','draft') AND total > amount_paid`,
    [companyId],
  );
  const documents = row?.outstanding ?? 0;
  const difference = ledger - documents;
  if (Math.abs(difference) < 100_00) return [];
  return [
    {
      type: "payment_mismatch",
      severity: "high",
      title: "Supplier balances and the ledger disagree",
      whatHappened: `Open bills total ${fmt(documents)} while account 2011 (trade payables) shows ${fmt(ledger)} — a difference of ${fmt(difference)}.`,
      whyProblem: "Payables you think you owe may not match what the ledger holds, which affects cash planning and supplier payments.",
      impactAmount: Math.abs(difference),
      howToFix: "Review bills posted without lines, expenses recorded as payables outside the bill module, and any manual entries to account 2011.",
      confidenceBp: 9000,
      fingerprint: `payable_mismatch:${difference}`,
    },
  ];
}

export function detectDuplicateExpenses(companyId: number): AlertCandidate[] {
  const rows = all<{ id: number; number: string; date: string; amount: number; account_id: number; count: number }>(
    `SELECT MIN(id) AS id, MIN(number) AS number, date, amount, account_id, COUNT(*) AS count
       FROM expenses WHERE company_id = ?
      GROUP BY date, amount, account_id, COALESCE(contact_id, 0), COALESCE(description, '')
      HAVING COUNT(*) > 1`,
    [companyId],
  );
  return rows.map((row) => ({
    type: "duplicate_transaction",
    severity: row.amount > 5_000_000 ? "high" : "medium",
    title: `Possible duplicate expense on ${row.date}`,
    whatHappened: `${row.count} expenses share the same date, amount (${fmt(row.amount)}) and account.`,
    whyProblem: "Duplicate expenses overstate costs and understate profit, and they often indicate the same invoice was entered twice (once from the bill, once from the receipt).",
    impactAmount: row.amount * (row.count - 1),
    howToFix: "Open Purchases → Expenses, compare the entries and reverse the duplicate with a correcting entry. BUXAI never deletes a posted entry.",
    confidenceBp: 8500,
    fingerprint: `duplicate_expense:${row.date}:${row.amount}:${row.account_id}`,
    relatedType: "expense",
    relatedId: row.id,
  }));
}

export function detectDuplicateInvoices(companyId: number): AlertCandidate[] {
  const rows = all<{ id: number; number: string; date: string; total: number; contact_id: number; count: number }>(
    `SELECT MIN(id) AS id, MIN(number) AS number, issue_date AS date, total, contact_id, COUNT(*) AS count
       FROM invoices WHERE company_id = ? AND status <> 'cancelled'
      GROUP BY issue_date, total, contact_id HAVING COUNT(*) > 1`,
    [companyId],
  );
  return rows.map((row) => ({
    type: "duplicate_transaction",
    severity: "medium",
    title: `Possible duplicate invoice for the same customer on ${row.date}`,
    whatHappened: `${row.count} invoices with the same date and total (${fmt(row.total)}) exist for one customer.`,
    whyProblem: "Duplicate sales invoices overstate revenue and receivables, and can lead to charging a customer twice.",
    impactAmount: row.total * (row.count - 1),
    howToFix: "Check with the customer; if one invoice is a duplicate, cancel it (BUXAI reverses the entry instead of deleting it).",
    confidenceBp: 8000,
    fingerprint: `duplicate_invoice:${row.date}:${row.total}:${row.contact_id}`,
    relatedType: "invoice",
    relatedId: row.id,
  }));
}

export function detectUnusualExpenses(companyId: number, period: Period): AlertCandidate[] {
  const breakdown = expenseBreakdown(companyId, period.from, period.to, period.previousFrom, period.previousTo);
  const alerts: AlertCandidate[] = [];
  for (const row of breakdown) {
    if (!row.accountId || row.amount === 0) continue;
    const stats = one<{ avg: number; count: number; max: number }>(
      `SELECT AVG(x.amount) AS avg, COUNT(*) AS count, MAX(x.amount) AS max
         FROM expenses x WHERE x.company_id = ? AND x.account_id = ?`,
      [companyId, row.accountId],
    );
    if ((stats?.count ?? 0) < 5 || !stats?.avg) continue;
    const baseline = stats.max && stats.count < 8 ? stats.max * 1.5 : stats.avg * 3;
    const largest = one<{ id: number; number: string; date: string; amount: number; description: string | null }>(
      "SELECT id, number, date, amount, description FROM expenses WHERE company_id = ? AND account_id = ? ORDER BY amount DESC LIMIT 1",
      [companyId, row.accountId],
    );
    if (!largest || largest.amount < baseline || largest.amount < 1_000_00) continue;
    alerts.push({
      type: "unusual_expense",
      severity: largest.amount > stats.avg * 5 ? "high" : "medium",
      title: `Unusually large expense: ${row.label}`,
      whatHappened: `${largest.number} on ${largest.date} is ${fmt(largest.amount)}, against an average of ${fmt(Math.round(stats.avg))} for this category over ${stats.count} entries.`,
      whyProblem: "A single expense far above the normal range distorts your monthly result and may indicate a posting error or an unrecorded approval.",
      impactAmount: largest.amount - Math.round(stats.avg),
      howToFix: `Open expense ${largest.number}, confirm the amount, category and attached document, and split or reclassify it if part of it belongs to another period.`,
      confidenceBp: 7800,
      fingerprint: `unusual_expense:${largest.id}`,
      relatedType: "expense",
      relatedId: largest.id,
    });
  }
  return alerts;
}

export function detectMissingDocuments(companyId: number, threshold = 1_000_00): AlertCandidate[] {
  const rows = all<{ id: number; number: string; date: string; amount: number }>(
    `SELECT id, number, date, amount + tax_amount AS amount FROM expenses
      WHERE company_id = ? AND source_document_id IS NULL AND (amount + tax_amount) >= ?
      ORDER BY date DESC LIMIT 25`,
    [companyId, threshold],
  );
  if (!rows.length) return [];
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return [
    {
      type: "missing_document",
      severity: "low",
      title: `${rows.length} expenses have no supporting document`,
      whatHappened: `Expenses worth ${fmt(total)} were recorded without an attached receipt or invoice (for example ${rows.slice(0, 3).map((row) => row.number).join(", ")}).`,
      whyProblem: "Without the source document you cannot support the deduction in an audit, and BUXAI cannot check whether the amount matches the paper.",
      impactAmount: total,
      howToFix: "Open Documents → AI document scanner, upload the receipts, and link each one to its expense.",
      confidenceBp: 9900,
      fingerprint: `missing_documents:${rows.length}:${Math.round(total / 1000)}`,
    },
  ];
}

export function detectStaleBankLines(companyId: number, days = 7): AlertCandidate[] {
  const cutoff = addDays(todayISO(), -days);
  const rows = all<{ id: number; date: string; amount: number; description: string; bankName: string }>(
    `SELECT t.id, t.date, t.amount, t.description, b.name AS bankName
       FROM bank_transactions t JOIN bank_accounts b ON b.id = t.bank_account_id
      WHERE t.company_id = ? AND t.status = 'unmatched' AND t.date <= ?
      ORDER BY t.date LIMIT 25`,
    [companyId, cutoff],
  );
  if (!rows.length) return [];
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return [
    {
      type: "bank_mismatch",
      severity: "medium",
      title: `${rows.length} bank lines are still unreconciled`,
      whatHappened: `Lines dated on or before ${cutoff} (${fmt(total)} in total) have not been matched, starting with "${rows[0].description.slice(0, 50)}" on ${rows[0].date}.`,
      whyProblem: "Unreconciled bank lines mean the cash position in BUXAI may not match the bank, which affects every cash-related decision.",
      impactAmount: total,
      howToFix: "Open Banking → Reconciliation and confirm the suggested matches, or create the missing transaction.",
      confidenceBp: 9800,
      fingerprint: `stale_bank_lines:${rows.length}:${Math.round(total / 1000)}`,
    },
  ];
}

export function detectNegativeBalances(companyId: number, asOf = todayISO()): AlertCandidate[] {
  const rows = all<{ id: number; code: string; name: string; balance: number }>(
    `SELECT a.id, a.code, a.name, COALESCE(SUM(l.base_debit - l.base_credit), 0) AS balance
       FROM accounts a
       LEFT JOIN journal_lines l ON l.account_id = a.id
       LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
      WHERE a.company_id = ? AND (a.subtype IN ('cash','bank') OR a.subtype = 'inventory')
      GROUP BY a.id HAVING balance < 0`,
    [companyId],
  );
  void asOf;
  return rows.map((row) => ({
    type: "negative_balance",
    severity: "high",
    title: `Negative balance on ${row.code} ${row.name}`,
    whatHappened: `The account shows ${fmt(row.balance)} — a credit balance where a debit balance is expected.`,
    whyProblem: "A negative cash, bank or inventory balance is impossible in reality and usually means a payment or a stock issue was posted from the wrong account.",
    impactAmount: Math.abs(row.balance),
    howToFix: "Open the general ledger for this account, find the entry that pushed it negative, and correct the account on the original document.",
    confidenceBp: 9500,
    fingerprint: `negative_balance:${row.id}`,
    relatedType: "account",
    relatedId: row.id,
  }));
}

export function detectOverdueReceivables(companyId: number, asOf = todayISO()): AlertCandidate[] {
  const rows = all<{ id: number; number: string; customerName: string; dueDate: string; amountDue: number }>(
    `SELECT i.id, i.number, c.name AS customerName, i.due_date AS dueDate, i.total - i.amount_paid AS amountDue
       FROM invoices i JOIN contacts c ON c.id = i.contact_id
      WHERE i.company_id = ? AND i.status IN ('sent','partially_paid','overdue')
        AND i.due_date < ? AND i.total > i.amount_paid
      ORDER BY i.due_date LIMIT 25`,
    [companyId, addDays(asOf, -30)],
  );
  if (!rows.length) return [];
  const total = rows.reduce((sum, row) => sum + row.amountDue, 0);
  return [
    {
      type: "overdue_receivable",
      severity: "medium",
      title: `${rows.length} invoices are more than 30 days overdue`,
      whatHappened: `${rows.length} unpaid invoices worth ${fmt(total)} passed their due date by more than 30 days (oldest: ${rows[0].number} — ${rows[0].customerName}).`,
      whyProblem: "Long-overdue receivables are the most common cause of cash shortages, and collectability drops the longer they stay open.",
      impactAmount: total,
      howToFix: "Open Sales → Receivables, prioritise the oldest items, and send reminders. Consider a payment plan for the largest debtor.",
      confidenceBp: 9600,
      fingerprint: `overdue_receivables:${rows.length}:${Math.round(total / 1000)}`,
    },
  ];
}

export function detectUnusualRevenue(companyId: number, asOf = todayISO()): AlertCandidate[] {
  const months = all<{ month: string; revenue: number }>(
    `SELECT substr(e.date,1,7) AS month, COALESCE(SUM(l.base_credit - l.base_debit),0) AS revenue
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND a.type = 'revenue' AND e.status = 'posted'
      GROUP BY month ORDER BY month DESC LIMIT 4`,
    [companyId],
  );
  if (months.length < 3) return [];
  const [latest, ...previous] = months;
  const average = previous.reduce((sum, row) => sum + row.revenue, 0) / previous.length;
  if (average <= 0 || latest.revenue < average * 2.2) return [];
  return [
    {
      type: "unusual_revenue",
      severity: "medium",
      title: `Revenue in ${monthKey(`${latest.month}-01`)} is far above your trend`,
      whatHappened: `Revenue of ${fmt(latest.revenue)} is ${(latest.revenue / average).toFixed(1)}× the average of the previous ${previous.length} months (${fmt(Math.round(average))}).`,
      whyProblem: "A spike can be genuine (a large contract) but it is also the pattern produced by a duplicated invoice or revenue recognised twice.",
      impactAmount: latest.revenue - Math.round(average),
      howToFix: "Open Reports → Revenue, drill into the month and confirm the largest invoices are distinct transactions.",
      confidenceBp: 7000,
      fingerprint: `unusual_revenue:${latest.month}:${Math.round(latest.revenue / 1000)}`,
      relatedType: "month",
      relatedId: null,
    },
  ];
}

export function detectUnusualSupplierActivity(companyId: number, asOf = todayISO()): AlertCandidate[] {
  const rows = all<{ contactId: number; name: string; total: number; count: number }>(
    `SELECT b.contact_id AS contactId, c.name AS name, SUM(b.total) AS total, COUNT(*) AS count
       FROM bills b JOIN contacts c ON c.id = b.contact_id
      WHERE b.company_id = ? AND b.issue_date >= ?
      GROUP BY b.contact_id ORDER BY total DESC LIMIT 5`,
    [companyId, addDays(asOf, -30)],
  );
  const alerts: AlertCandidate[] = [];
  for (const row of rows) {
    const history = one<{ avg: number; count: number }>(
      `SELECT AVG(monthly) AS avg, COUNT(*) AS count FROM (
          SELECT substr(issue_date,1,7) AS month, SUM(total) AS monthly FROM bills
           WHERE company_id = ? AND contact_id = ? AND issue_date < ? GROUP BY month)`,
      [companyId, row.contactId, addDays(asOf, -30)],
    );
    if ((history?.count ?? 0) < 2 || !history?.avg) continue;
    if (row.total < history.avg * 2.5) continue;
    alerts.push({
      type: "unusual_supplier",
      severity: "low",
      title: `Unusual activity with ${row.name}`,
      whatHappened: `${fmt(row.total)} billed in the last 30 days across ${row.count} bills, against a monthly average of ${fmt(Math.round(history.avg))}.`,
      whyProblem: "A sharp rise in a supplier's activity can indicate duplicated bills, a pricing change, or purchases that belong to another period.",
      impactAmount: row.total - Math.round(history.avg),
      howToFix: "Review the supplier's bills, confirm the goods or services were received, and check whether the bills should be split across periods.",
      confidenceBp: 6600,
      fingerprint: `unusual_supplier:${row.contactId}:${Math.round(row.total / 1000)}`,
      relatedType: "contact",
      relatedId: row.contactId,
    });
  }
  return alerts;
}

export function detectCategoryMismatches(companyId: number): AlertCandidate[] {
  const rows = all<{ id: number; number: string; description: string | null; categoryName: string | null; amount: number }>(
    `SELECT x.id, x.number, x.description, c.name AS categoryName, x.amount
       FROM expenses x LEFT JOIN categories c ON c.id = x.category_id
      WHERE x.company_id = ? AND x.description IS NOT NULL
      ORDER BY x.date DESC LIMIT 100`,
    [companyId],
  );
  const alerts: AlertCandidate[] = [];
  for (const row of rows) {
    if (!row.description || !row.categoryName) continue;
    const suggestion = suggestCategory(companyId, row.description);
    if (!suggestion.categoryId || !suggestion.categoryName) continue;
    if (suggestion.confidence < 6000) continue;
    if (suggestion.categoryName.toLowerCase() === row.categoryName.toLowerCase()) continue;
    alerts.push({
      type: "wrong_category",
      severity: "low",
      title: `Possible wrong category on expense ${row.number}`,
      whatHappened: `The expense is recorded as "${row.categoryName}" but the description suggests "${suggestion.categoryName}".`,
      whyProblem: "Categories drive your expense breakdown, budgets and tax analysis. A misclassified expense distorts all three.",
      impactAmount: row.amount,
      howToFix: `Open expense ${row.number} and change the category if the suggestion is right. BUXAI voids and re-posts the entry so the ledger stays clean.`,
      confidenceBp: suggestion.confidence,
      fingerprint: `category_mismatch:${row.id}`,
      relatedType: "expense",
      relatedId: row.id,
    });
  }
  return alerts.slice(0, 10);
}

export function runXatoRadar(companyId: number, period: Period, ctx: Ctx = {}): { created: number; updated: number; total: number } {
  return tx(() => {
    const candidates: AlertCandidate[] = [
      ...detectLedgerImbalance(companyId),
      ...detectReceivableMismatch(companyId, period.to),
      ...detectPayableMismatch(companyId, period.to),
      ...detectDuplicateExpenses(companyId),
      ...detectDuplicateInvoices(companyId),
      ...detectUnusualExpenses(companyId, period),
      ...detectMissingDocuments(companyId),
      ...detectStaleBankLines(companyId),
      ...detectNegativeBalances(companyId, period.to),
      ...detectOverdueReceivables(companyId, period.to),
      ...detectUnusualRevenue(companyId, period.to),
      ...detectUnusualSupplierActivity(companyId, period.to),
      ...detectCategoryMismatches(companyId),
    ];

    let created = 0;
    let updated = 0;
    for (const candidate of candidates) {
      const existing = one<{ id: number; status: string }>(
        "SELECT id, status FROM alerts WHERE company_id = ? AND fingerprint = ?",
        [companyId, candidate.fingerprint],
      );
      if (existing) {
        run(
          `UPDATE alerts SET severity = ?, title = ?, what_happened = ?, why_problem = ?, impact_amount = ?, how_to_fix = ?,
             confidence_bp = ?, detected_at = ?, meta = ? WHERE id = ?`,
          [
            candidate.severity,
            candidate.title,
            candidate.whatHappened,
            candidate.whyProblem,
            candidate.impactAmount,
            candidate.howToFix,
            candidate.confidenceBp,
            nowISO(),
            JSON.stringify(candidate.meta ?? {}),
            existing.id,
          ],
        );
        updated += 1;
      } else {
        insert(
          `INSERT INTO alerts (company_id, type, severity, title, what_happened, why_problem, impact_amount, how_to_fix,
            confidence_bp, status, fingerprint, related_type, related_id, meta, detected_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
          [
            companyId,
            candidate.type,
            candidate.severity,
            candidate.title,
            candidate.whatHappened,
            candidate.whyProblem,
            candidate.impactAmount,
            candidate.howToFix,
            candidate.confidenceBp,
            candidate.fingerprint,
            candidate.relatedType ?? null,
            candidate.relatedId ?? null,
            JSON.stringify(candidate.meta ?? {}),
            nowISO(),
          ],
        );
        created += 1;
      }
    }

    // Findings that no longer reproduce are auto-resolved, keeping the board honest.
    const activeFingerprints = new Set(candidates.map((candidate) => candidate.fingerprint));
    const openAlerts = all<{ id: number; fingerprint: string; status: string }>(
      "SELECT id, fingerprint, status FROM alerts WHERE company_id = ? AND status IN ('open','reviewing')",
      [companyId],
    );
    for (const alert of openAlerts) {
      if (!activeFingerprints.has(alert.fingerprint)) {
        run("UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE id = ?", [nowISO(), alert.id]);
      }
    }

    if (ctx.userId) {
      recordAudit({
        companyId,
        userId: ctx.userId,
        userName: ctx.userName,
        action: "scan",
        entityType: "xato_radar",
        summary: `Xato Radar scan: ${created} new, ${updated} refreshed, ${candidates.length} checks triggered findings`,
        after: { created, updated },
      });
    }

    return { created, updated, total: candidates.length };
  });
}

export function listAlerts(companyId: number, filters: { status?: string; severity?: string; type?: string; limit?: number } = {}) {
  const conditions = ["company_id = ?"];
  const params: unknown[] = [companyId];
  if (filters.status && filters.status !== "all") {
    conditions.push(filters.status === "open" ? "status IN ('open','reviewing')" : "status = ?");
    if (filters.status !== "open") params.push(filters.status);
  }
  if (filters.severity && filters.severity !== "all") {
    conditions.push("severity = ?");
    params.push(filters.severity);
  }
  if (filters.type && filters.type !== "all") {
    conditions.push("type = ?");
    params.push(filters.type);
  }
  params.push(filters.limit ?? 100);
  return all<{
    id: number;
    type: string;
    severity: string;
    title: string;
    whatHappened: string;
    whyProblem: string;
    impactAmount: number;
    howToFix: string;
    confidenceBp: number;
    status: string;
    relatedType: string | null;
    relatedId: number | null;
    detectedAt: string;
    resolvedAt: string | null;
  }>(
    `SELECT id, type, severity, title, what_happened AS whatHappened, why_problem AS whyProblem, impact_amount AS impactAmount,
            how_to_fix AS howToFix, confidence_bp AS confidenceBp, status, related_type AS relatedType,
            related_id AS relatedId, detected_at AS detectedAt, resolved_at AS resolvedAt
       FROM alerts WHERE ${conditions.join(" AND ")}
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, impact_amount DESC
      LIMIT ?`,
    params,
  );
}

export function alertStats(companyId: number) {
  const row = one<{ open: number; resolved: number; critical: number; exposure: number; criticalExposure: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('open','reviewing') THEN 1 ELSE 0 END), 0) AS open,
       COALESCE(SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END), 0) AS resolved,
       COALESCE(SUM(CASE WHEN status IN ('open','reviewing') AND severity IN ('high','critical') THEN 1 ELSE 0 END), 0) AS critical,
       COALESCE(SUM(CASE WHEN status IN ('open','reviewing') THEN impact_amount ELSE 0 END), 0) AS exposure,
       COALESCE(SUM(CASE WHEN status IN ('open','reviewing') AND severity IN ('high','critical') THEN impact_amount ELSE 0 END), 0) AS criticalExposure
     FROM alerts WHERE company_id = ?`,
    [companyId],
  );
  const bySeverity = all<{ severity: string; count: number }>(
    "SELECT severity, COUNT(*) AS count FROM alerts WHERE company_id = ? AND status IN ('open','reviewing') GROUP BY severity",
    [companyId],
  );
  const byType = all<{ type: string; count: number; exposure: number }>(
    `SELECT type, COUNT(*) AS count, COALESCE(SUM(impact_amount),0) AS exposure FROM alerts
      WHERE company_id = ? AND status IN ('open','reviewing') GROUP BY type ORDER BY exposure DESC`,
    [companyId],
  );
  return {
    open: row?.open ?? 0,
    resolved: row?.resolved ?? 0,
    critical: row?.critical ?? 0,
    exposure: row?.exposure ?? 0,
    criticalExposure: row?.criticalExposure ?? 0,
    bySeverity,
    byType,
  };
}

export function updateAlertStatus(
  companyId: number,
  alertId: number,
  status: "open" | "reviewing" | "resolved" | "ignored",
  ctx: Ctx = {},
): void {
  run("UPDATE alerts SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND company_id = ?", [
    status,
    status === "resolved" || status === "ignored" ? nowISO() : null,
    ctx.userId ?? null,
    alertId,
    companyId,
  ]);
  recordAudit({
    companyId,
    userId: ctx.userId,
    userName: ctx.userName,
    action: status === "ignored" ? "ignore" : status === "resolved" ? "resolve" : "review",
    entityType: "alert",
    entityId: alertId,
    summary: `Xato Radar alert marked as ${status}`,
    after: { status },
  });
}

/* ------------------------------------------------------------------ tasks */
export type TaskRow = {
  id: number;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  status: string;
  dueDate: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  relatedType: string | null;
  relatedId: number | null;
  source: string;
  createdAt: string;
  completedAt: string | null;
};

export function generateTasks(companyId: number, period: Period, ctx: Ctx = {}): number {
  return tx(() => {
    const stamp = nowISO();
    const created: { key: string; title: string; description: string; type: string; priority: string; due: string | null; relatedType: string; relatedId: number | null }[] = [];

    const overdue = all<{ id: number; number: string; customerName: string; dueDate: string; amountDue: number }>(
      `SELECT i.id, i.number, c.name AS customerName, i.due_date AS dueDate, i.total - i.amount_paid AS amountDue
         FROM invoices i JOIN contacts c ON c.id = i.contact_id
        WHERE i.company_id = ? AND i.status = 'overdue' AND i.total > i.amount_paid
        ORDER BY i.due_date LIMIT 10`,
      [companyId],
    );
    for (const invoice of overdue) {
      created.push({
        key: `collect-invoice-${invoice.id}`,
        title: `Collect overdue invoice ${invoice.number}`,
        description: `${invoice.customerName} owes ${fmt(invoice.amountDue)}; due ${invoice.dueDate}.`,
        type: "collection",
        priority: "high",
        due: invoice.dueDate,
        relatedType: "invoice",
        relatedId: invoice.id,
      });
    }

    const unreconciled = one<{ count: number; total: number }>(
      "SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total FROM bank_transactions WHERE company_id = ? AND status = 'unmatched'",
      [companyId],
    );
    if ((unreconciled?.count ?? 0) > 0) {
      created.push({
        key: `reconcile-bank-${unreconciled?.count}`,
        title: `Reconcile ${unreconciled?.count} bank lines`,
        description: `${fmt(unreconciled?.total ?? 0)} in bank movements is not matched to the ledger yet.`,
        type: "reconciliation",
        priority: "high",
        due: todayISO(),
        relatedType: "bank",
        relatedId: null,
      });
    }

    const documents = one<{ count: number }>("SELECT COUNT(*) AS count FROM documents WHERE company_id = ? AND status = 'needs_review'", [
      companyId,
    ]);
    if ((documents?.count ?? 0) > 0) {
      created.push({
        key: `review-documents-${documents?.count}`,
        title: `Review ${documents?.count} uploaded documents`,
        description: "Confirm the extracted amounts before they are posted to the ledger.",
        type: "review",
        priority: "medium",
        due: todayISO(),
        relatedType: "document",
        relatedId: null,
      });
    }

    const criticalAlerts = all<{ id: number; title: string; severity: string }>(
      "SELECT id, title, severity FROM alerts WHERE company_id = ? AND status IN ('open','reviewing') AND severity IN ('high','critical') LIMIT 10",
      [companyId],
    );
    for (const alert of criticalAlerts) {
      created.push({
        key: `fix-alert-${alert.id}`,
        title: `Resolve: ${alert.title}`,
        description: "Xato Radar flagged this issue. Review the finding and apply the suggested fix.",
        type: "error",
        priority: alert.severity === "critical" ? "high" : "medium",
        due: todayISO(),
        relatedType: "alert",
        relatedId: alert.id,
      });
    }

    const billsDue = all<{ id: number; number: string; supplierName: string; dueDate: string; amountDue: number }>(
      `SELECT b.id, b.number, c.name AS supplierName, b.due_date AS dueDate, b.total - b.amount_paid AS amountDue
         FROM bills b JOIN contacts c ON c.id = b.contact_id
        WHERE b.company_id = ? AND b.total > b.amount_paid AND b.due_date <= ?
        ORDER BY b.due_date LIMIT 10`,
      [companyId, addDays(todayISO(), 7)],
    );
    for (const bill of billsDue) {
      created.push({
        key: `pay-bill-${bill.id}`,
        title: `Approve payment for bill ${bill.number}`,
        description: `${bill.supplierName} — ${fmt(bill.amountDue)} due ${bill.dueDate}.`,
        type: "approval",
        priority: bill.dueDate < todayISO() ? "high" : "medium",
        due: bill.dueDate,
        relatedType: "bill",
        relatedId: bill.id,
      });
    }

    const close = one<{ status: string }>("SELECT status FROM month_closes WHERE company_id = ? AND period = ?", [
      companyId,
      monthKey(period.to),
    ]);
    if (!close || close.status !== "closed") {
      created.push({
        key: `month-end-${monthKey(period.to)}`,
        title: `Complete month-end close for ${monthKey(period.to)}`,
        description: "Review the close checklist: reconciliation, receivables, payables, inventory, payroll, taxes and control totals.",
        type: "close",
        priority: "medium",
        due: endOfMonth(period.to),
        relatedType: "period",
        relatedId: null,
      });
    }

    let inserted = 0;
    for (const task of created) {
      const exists = one<{ id: number }>("SELECT id FROM tasks WHERE company_id = ? AND auto_key = ?", [companyId, task.key]);
      if (exists) {
        run("UPDATE tasks SET title = ?, description = ?, priority = ?, due_date = ?, related_type = ?, related_id = ? WHERE id = ?", [
          task.title,
          task.description,
          task.priority,
          task.due,
          task.relatedType,
          task.relatedId,
          exists.id,
        ]);
        continue;
      }
      insert(
        `INSERT INTO tasks (company_id, title, description, type, priority, status, due_date, related_type, related_id,
          source, auto_key, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, 'auto', ?, ?, ?)`,
        [
          companyId,
          task.title,
          task.description,
          task.type,
          task.priority,
          task.due,
          task.relatedType,
          task.relatedId,
          task.key,
          ctx.userId ?? null,
          stamp,
        ],
      );
      inserted += 1;
    }

    return inserted;
  });
}

export function listTasks(companyId: number, status?: string) {
  const params: unknown[] = [companyId];
  let filter = "";
  if (status && status !== "all") {
    filter = " AND t.status = ?";
    params.push(status);
  }
  return all<TaskRow>(
    `SELECT t.id, t.title, t.description, t.type, t.priority, t.status, t.due_date AS dueDate, t.assignee_id AS assigneeId,
            u.name AS assigneeName, t.related_type AS relatedType, t.related_id AS relatedId, t.source,
            t.created_at AS createdAt, t.completed_at AS completedAt
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.company_id = ?${filter}
      ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
               CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END, COALESCE(t.due_date, '9999')`,
    params,
  );
}

export function taskStats(companyId: number) {
  const row = one<{ todo: number; inProgress: number; completed: number; overdue: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END),0) AS todo,
       COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END),0) AS inProgress,
       COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END),0) AS completed,
       COALESCE(SUM(CASE WHEN status <> 'completed' AND due_date < date('now') THEN 1 ELSE 0 END),0) AS overdue
     FROM tasks WHERE company_id = ?`,
    [companyId],
  );
  return row ?? { todo: 0, inProgress: 0, completed: 0, overdue: 0 };
}

export function createTask(
  companyId: number,
  input: { title: string; description?: string; priority?: string; dueDate?: string | null; type?: string },
  ctx: Ctx = {},
) {
  return insert(
    `INSERT INTO tasks (company_id, title, description, type, priority, status, due_date, assignee_id, source, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, 'manual', ?, ?)`,
    [
      companyId,
      input.title,
      input.description ?? null,
      input.type ?? "review",
      input.priority ?? "medium",
      input.dueDate ?? null,
      ctx.userId ?? null,
      ctx.userId ?? null,
      nowISO(),
    ],
  );
}

export function updateTaskStatus(companyId: number, taskId: number, status: "todo" | "in_progress" | "completed"): void {
  run("UPDATE tasks SET status = ?, completed_at = ? WHERE id = ? AND company_id = ?", [
    status,
    status === "completed" ? nowISO() : null,
    taskId,
    companyId,
  ]);
}

export function deleteTask(companyId: number, taskId: number): void {
  run("DELETE FROM tasks WHERE id = ? AND company_id = ? AND source = 'manual'", [taskId, companyId]);
}

/* ---------------------------------------------------------- notifications */
export function generateNotifications(companyId: number, period: Period): number {
  const candidates: { key: string; kind: string; title: string; body: string; severity: string; link: string }[] = [];

  for (const alert of listAlerts(companyId, { status: "open", limit: 40 })) {
    candidates.push({
      key: `alert-${alert.id}-${alert.severity}`,
      kind: alert.type,
      title: alert.title,
      body: alert.whatHappened,
      severity: alert.severity === "critical" ? "critical" : alert.severity === "high" ? "warning" : "info",
      link: "/ai-center/xato-radar",
    });
  }

  const overdueInvoices = all<{ number: string; customerName: string; amountDue: number }>(
    `SELECT i.number, c.name AS customerName, i.total - i.amount_paid AS amountDue
       FROM invoices i JOIN contacts c ON c.id = i.contact_id
      WHERE i.company_id = ? AND i.status = 'overdue' LIMIT 10`,
    [companyId],
  );
  for (const invoice of overdueInvoices) {
    candidates.push({
      key: `overdue-invoice-${invoice.number}`,
      kind: "invoice_overdue",
      title: `Invoice ${invoice.number} is overdue`,
      body: `${invoice.customerName} — ${fmt(invoice.amountDue)} still outstanding.`,
      severity: "warning",
      link: "/sales/invoices?status=overdue",
    });
  }

  const dueSoon = all<{ number: string; supplierName: string; dueDate: string; amountDue: number }>(
    `SELECT b.number, c.name AS supplierName, b.due_date AS dueDate, b.total - b.amount_paid AS amountDue
       FROM bills b JOIN contacts c ON c.id = b.contact_id
      WHERE b.company_id = ? AND b.total > b.amount_paid AND b.due_date <= ? LIMIT 10`,
    [companyId, addDays(todayISO(), 7)],
  );
  for (const bill of dueSoon) {
    candidates.push({
      key: `due-bill-${bill.number}`,
      kind: "payment_due",
      title: `Bill ${bill.number} is due ${bill.dueDate}`,
      body: `${bill.supplierName} — ${fmt(bill.amountDue)} to pay.`,
      severity: "info",
      link: "/purchases/bills",
    });
  }

  const lowStock = all<{ name: string; sku: string; qtyMilli: number; minStockMilli: number }>(
    `SELECT * FROM (
       SELECT p.name AS name, p.sku AS sku,
              COALESCE((SELECT SUM(qty_milli) FROM v_stock_balances b WHERE b.product_id = p.id), 0) AS qtyMilli,
              p.min_stock_milli AS minStockMilli
         FROM products p WHERE p.company_id = ? AND p.min_stock_milli > 0 AND p.is_archived = 0
     ) WHERE qtyMilli <= minStockMilli LIMIT 10`,
    [companyId],
  );
  for (const product of lowStock) {
    candidates.push({
      key: `low-stock-${product.sku}`,
      kind: "low_stock",
      title: `Low stock: ${product.name}`,
      body: `${(product.qtyMilli / 1000).toLocaleString("en-US")} units left against a minimum of ${(product.minStockMilli / 1000).toLocaleString("en-US")}.`,
      severity: "warning",
      link: "/inventory/stock",
    });
  }

  const obligations = all<{ name: string; dueDate: string; amount: number }>(
    `SELECT name, due_date AS dueDate, amount FROM tax_obligations
      WHERE company_id = ? AND status <> 'paid' AND due_date <= ? LIMIT 10`,
    [companyId, addDays(todayISO(), 14)],
  );
  for (const obligation of obligations) {
    candidates.push({
      key: `tax-${obligation.name}-${obligation.dueDate}`,
      kind: "tax_deadline",
      title: `${obligation.name} due ${obligation.dueDate}`,
      body: `${fmt(obligation.amount)} due — verify the amount and deadline with your tax adviser.`,
      severity: "warning",
      link: "/tax-center",
    });
  }

  void period;
  let created = 0;
  for (const candidate of candidates) {
    const exists = one<{ id: number }>("SELECT id FROM notifications WHERE company_id = ? AND dedupe_key = ?", [companyId, candidate.key]);
    if (exists) continue;
    insert(
      `INSERT INTO notifications (company_id, kind, title, body, severity, link, is_read, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [companyId, candidate.kind, candidate.title, candidate.body, candidate.severity, candidate.link, candidate.key, nowISO()],
    );
    created += 1;
  }
  return created;
}

export function listNotifications(companyId: number, filters: { unreadOnly?: boolean; limit?: number } = {}) {
  return all<{ id: number; kind: string; title: string; body: string | null; severity: string; link: string | null; isRead: number; createdAt: string }>(
    `SELECT id, kind, title, body, severity, link, is_read AS isRead, created_at AS createdAt
       FROM notifications WHERE company_id = ? ${filters.unreadOnly ? "AND is_read = 0" : ""}
      ORDER BY id DESC LIMIT ?`,
    [companyId, filters.limit ?? 100],
  );
}

export function unreadNotificationCount(companyId: number): number {
  return one<{ count: number }>("SELECT COUNT(*) AS count FROM notifications WHERE company_id = ? AND is_read = 0", [companyId])?.count ?? 0;
}

export function markNotificationRead(companyId: number, notificationId: number): void {
  run("UPDATE notifications SET is_read = 1 WHERE id = ? AND company_id = ?", [notificationId, companyId]);
}

export function markAllNotificationsRead(companyId: number): void {
  run("UPDATE notifications SET is_read = 1 WHERE company_id = ?", [companyId]);
}

/* --------------------------------------------------------- month-end close */
export type CloseStep = {
  key: string;
  label: string;
  status: "pass" | "warning" | "fail" | "done" | "pending";
  detail: string;
  blocking: boolean;
  action?: { label: string; href: string };
};

export type CloseState = {
  period: string;
  status: string;
  steps: CloseStep[];
  completed: number;
  total: number;
  blockers: number;
  canClose: boolean;
};

export function monthEndCloseState(companyId: number, periodKey: string): CloseState {
  const [year, month] = periodKey.split("-").map(Number);
  const period: Period = resolvePeriod("custom", {
    from: `${periodKey}-01`,
    to: endOfMonth(`${periodKey}-01`),
    today: todayISO(),
  });
  void year;
  void month;

  const steps: CloseStep[] = [];

  const bankUnmatched = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM bank_transactions WHERE company_id = ? AND status = 'unmatched'",
    [companyId],
  )?.count ?? 0;
  steps.push({
    key: "bank",
    label: "Bank reconciliation",
    status: bankUnmatched === 0 ? "pass" : "warning",
    detail: bankUnmatched === 0 ? "All bank lines are matched or ignored." : `${bankUnmatched} bank lines are still unreconciled.`,
    blocking: false,
    action: { label: "Open reconciliation", href: "/banking/reconciliation" },
  });

  const cashAccounts = all<{ code: string; name: string; balance: number }>(
    `SELECT a.code, a.name, COALESCE(SUM(l.base_debit - l.base_credit), 0) AS balance
       FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
       LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
      WHERE a.company_id = ? AND a.subtype IN ('cash','bank') GROUP BY a.id`,
    [companyId],
  );
  const negativeCash = cashAccounts.filter((account) => account.balance < 0);
  steps.push({
    key: "cash",
    label: "Cash & bank reconciliation",
    status: negativeCash.length === 0 ? "pass" : "fail",
    detail:
      negativeCash.length === 0
        ? `${cashAccounts.length} cash and bank accounts have consistent balances.`
        : `${negativeCash.map((account) => account.code).join(", ")} show negative balances.`,
    blocking: true,
    action: { label: "Open chart of accounts", href: "/accounting/chart-of-accounts" },
  });

  const arDifference = detectReceivableMismatch(companyId, period.to)[0];
  steps.push({
    key: "receivables",
    label: "Receivables review",
    status: arDifference ? "warning" : "pass",
    detail: arDifference ? arDifference.whatHappened : "Unpaid invoices agree with the receivables ledger balance.",
    blocking: false,
    action: { label: "Open receivables", href: "/reports/receivables" },
  });

  const apDifference = detectPayableMismatch(companyId, period.to)[0];
  steps.push({
    key: "payables",
    label: "Payables review",
    status: apDifference ? "warning" : "pass",
    detail: apDifference ? apDifference.whatHappened : "Open bills agree with the payables ledger balance.",
    blocking: false,
    action: { label: "Open payables", href: "/reports/payables" },
  });

  const inventoryCheck = one<{ value: number; ledger: number }>(
    `SELECT
        (SELECT COALESCE(SUM(value),0) FROM v_stock_balances WHERE company_id = ?) AS value,
        (SELECT COALESCE(SUM(l.base_debit - l.base_credit),0) FROM journal_lines l
           JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
          WHERE l.company_id = ? AND a.code = '1201' AND e.status = 'posted') AS ledger`,
    [companyId, companyId],
  );
  const inventoryDifference = (inventoryCheck?.ledger ?? 0) - (inventoryCheck?.value ?? 0);
  steps.push({
    key: "inventory",
    label: "Inventory review",
    status: Math.abs(inventoryDifference) < 100_00 ? "pass" : "warning",
    detail:
      Math.abs(inventoryDifference) < 100_00
        ? "Stock valuation agrees with the inventory ledger account."
        : `Stock valuation differs from account 1201 by ${fmt(inventoryDifference)}.`,
    blocking: false,
    action: { label: "Open inventory", href: "/inventory/stock" },
  });

  const payrollRun = one<{ period: string; status: string }>(
    "SELECT period, status FROM payroll_runs WHERE company_id = ? AND period = ?",
    [companyId, periodKey],
  );
  steps.push({
    key: "payroll",
    label: "Payroll review",
    status: payrollRun ? (payrollRun.status === "draft" ? "warning" : "pass") : "warning",
    detail: payrollRun ? `Payroll ${payrollRun.period} is ${payrollRun.status}.` : `No payroll run exists for ${periodKey}.`,
    blocking: false,
    action: { label: "Open payroll", href: "/employees/payroll" },
  });

  const taxReady = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM tax_obligations WHERE company_id = ? AND period = ?",
    [companyId, periodKey],
  )?.count ?? 0;
  steps.push({
    key: "tax",
    label: "Tax review",
    status: taxReady > 0 ? "pass" : "warning",
    detail: taxReady > 0 ? `${taxReady} tax obligations recorded for the period.` : "No tax obligations recorded for this period yet — calculate them in Tax centre.",
    blocking: false,
    action: { label: "Open tax centre", href: "/tax-center" },
  });

  const duplicates = detectDuplicateExpenses(companyId).length + detectDuplicateInvoices(companyId).length;
  steps.push({
    key: "duplicates",
    label: "Duplicate detection",
    status: duplicates === 0 ? "pass" : "warning",
    detail: duplicates === 0 ? "No duplicates detected." : `${duplicates} possible duplicates need review.`,
    blocking: false,
    action: { label: "Open Xato Radar", href: "/ai-center/xato-radar" },
  });

  const unusual = detectUnusualExpenses(companyId, period).length;
  steps.push({
    key: "unusual",
    label: "Unusual transaction review",
    status: unusual === 0 ? "pass" : "warning",
    detail: unusual === 0 ? "No unusual expenses detected." : `${unusual} unusual expenses need review.`,
    blocking: false,
    action: { label: "Open Xato Radar", href: "/ai-center/xato-radar" },
  });

  const tb = trialBalance(companyId, period.from, period.to);
  steps.push({
    key: "trial",
    label: "Trial balance",
    status: tb.balanced ? "pass" : "fail",
    detail: tb.balanced
      ? `Debits and credits both total ${fmt(tb.totals.debit)}.`
      : `Trial balance is out by ${fmt(tb.totals.debit - tb.totals.credit)}.`,
    blocking: true,
    action: { label: "Open trial balance", href: "/accounting/trial-balance" },
  });

  const is = incomeStatement(companyId, period.from, period.to, period.previousFrom, period.previousTo);
  steps.push({
    key: "pl",
    label: "Profit & Loss",
    status: "pass",
    detail: `Revenue ${fmt(is.revenue.total)}, net profit ${fmt(is.netProfit)}.`,
    blocking: false,
    action: { label: "Open P&L", href: "/reports/profit-loss" },
  });

  const bsBalanced = (() => {
    const row = one<{ assets: number; liabilities: number; equity: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN a.type = 'asset' THEN l.base_debit - l.base_credit ELSE 0 END),0) AS assets,
         COALESCE(SUM(CASE WHEN a.type = 'liability' THEN l.base_credit - l.base_debit ELSE 0 END),0) AS liabilities,
         COALESCE(SUM(CASE WHEN a.type = 'equity' THEN l.base_credit - l.base_debit ELSE 0 END),0) AS equity
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
       WHERE l.company_id = ? AND e.status = 'posted' AND e.date <= ?`,
      [companyId, period.to],
    );
    const assets = row?.assets ?? 0;
    const right = (row?.liabilities ?? 0) + (row?.equity ?? 0) + is.netProfit;
    return { balanced: Math.abs(assets - right) < 100, assets, right };
  })();
  steps.push({
    key: "bs",
    label: "Balance sheet",
    status: bsBalanced.balanced ? "pass" : "fail",
    detail: bsBalanced.balanced
      ? `Assets ${fmt(bsBalanced.assets)} equal liabilities and equity.`
      : `Assets ${fmt(bsBalanced.assets)} differ from liabilities + equity ${fmt(bsBalanced.right)}.`,
    blocking: true,
    action: { label: "Open balance sheet", href: "/reports/balance-sheet" },
  });

  const close = one<{ status: string; completed_at: string | null; completed_by: number | null }>(
    "SELECT status, completed_at, completed_by FROM month_closes WHERE company_id = ? AND period = ?",
    [companyId, periodKey],
  );
  steps.push({
    key: "approve",
    label: "Final approval",
    status: close?.status === "closed" ? "done" : "pending",
    detail: close?.status === "closed" ? `Period closed${close.completed_at ? ` on ${close.completed_at.slice(0, 10)}` : ""}.` : "Waiting for your approval.",
    blocking: false,
  });

  const blockers = steps.filter((step) => step.blocking && (step.status === "fail" || step.status === "warning")).length;
  const completed = steps.filter((step) => step.status === "pass" || step.status === "done").length;

  return {
    period: periodKey,
    status: close?.status ?? "open",
    steps,
    completed,
    total: steps.length,
    blockers,
    canClose: blockers === 0,
  };
}

export function closePeriod(companyId: number, periodKey: string, ctx: Ctx = {}): CloseState {
  return tx(() => {
    const state = monthEndCloseState(companyId, periodKey);
    if (!state.canClose) {
      throw new Error(
        `CLOSE_BLOCKED: ${state.blockers} critical accounting check(s) must be resolved before closing ${periodKey}.`,
      );
    }
    const periodEnd = endOfMonth(`${periodKey}-01`);
    const existing = one<{ id: number }>("SELECT id FROM month_closes WHERE company_id = ? AND period = ?", [companyId, periodKey]);
    if (existing) {
      run("UPDATE month_closes SET status = 'closed', checks = ?, blockers = 0, completed_at = ?, completed_by = ?, updated_at = ? WHERE id = ?", [
        JSON.stringify(state.steps),
        nowISO(),
        ctx.userId ?? null,
        nowISO(),
        existing.id,
      ]);
    } else {
      insert(
        `INSERT INTO month_closes (company_id, period, status, checks, blockers, completed_at, completed_by, created_at, updated_at)
         VALUES (?, ?, 'closed', ?, 0, ?, ?, ?, ?)`,
        [companyId, periodKey, JSON.stringify(state.steps), nowISO(), ctx.userId ?? null, nowISO(), nowISO()],
      );
    }
    run("UPDATE companies SET locked_through = ?, updated_at = ? WHERE id = ?", [periodEnd, nowISO(), companyId]);
    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "close",
      entityType: "period",
      summary: `Closed accounting period ${periodKey} (ledger locked through ${periodEnd})`,
      after: { period: periodKey, lockedThrough: periodEnd },
    });
    return monthEndCloseState(companyId, periodKey);
  });
}

export function reopenPeriod(companyId: number, periodKey: string, ctx: Ctx = {}): CloseState {
  return tx(() => {
    run("UPDATE month_closes SET status = 'in_progress', completed_at = NULL, reopened_at = ?, updated_at = ? WHERE company_id = ? AND period = ?", [
      nowISO(),
      nowISO(),
      companyId,
      periodKey,
    ]);
    const previous = one<{ period: string }>(
      "SELECT period FROM month_closes WHERE company_id = ? AND status = 'closed' AND period < ? ORDER BY period DESC LIMIT 1",
      [companyId, periodKey],
    );
    const lockThrough = previous ? endOfMonth(`${previous.period}-01`) : null;
    run("UPDATE companies SET locked_through = ?, updated_at = ? WHERE id = ?", [lockThrough, nowISO(), companyId]);
    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "reopen",
      entityType: "period",
      summary: `Reopened accounting period ${periodKey}`,
      after: { period: periodKey, lockedThrough: lockThrough },
    });
    return monthEndCloseState(companyId, periodKey);
  });
}

export function availableClosePeriods(companyId: number, months = 6): { period: string; status: string }[] {
  const rows: { period: string; status: string }[] = [];
  for (let index = 0; index < months; index += 1) {
    const date = new Date();
    date.setMonth(date.getMonth() - index);
    const key = date.toISOString().slice(0, 7);
    const close = one<{ status: string }>("SELECT status FROM month_closes WHERE company_id = ? AND period = ?", [companyId, key]);
    rows.push({ period: key, status: close?.status ?? "open" });
  }
  return rows;
}

/* --------------------------------------------------------------- budgets */
export type BudgetInput = {
  companyId: number;
  name: string;
  periodType: "month" | "quarter" | "year";
  year: number;
  periodIndex: number;
  scope: "company" | "department" | "category" | "account";
  departmentId?: number | null;
  categoryId?: number | null;
  accountId?: number | null;
  amount: number;
  notes?: string;
};

export function createBudget(input: BudgetInput, ctx: Ctx = {}): number {
  return tx(() => {
    const id = insert(
      `INSERT INTO budgets (company_id, name, period_type, year, period_index, scope, department_id, category_id, account_id,
        amount, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.companyId,
        input.name,
        input.periodType,
        input.year,
        input.periodIndex,
        input.scope,
        input.departmentId ?? null,
        input.categoryId ?? null,
        input.accountId ?? null,
        Math.round(input.amount),
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
      action: "create",
      entityType: "budget",
      entityId: id,
      summary: `Created budget "${input.name}" (${input.amount})`,
      after: input,
    });
    return id;
  });
}

export function deleteBudget(companyId: number, budgetId: number, ctx: Ctx = {}): void {
  run("DELETE FROM budgets WHERE id = ? AND company_id = ?", [budgetId, companyId]);
  recordAudit({
    companyId,
    userId: ctx.userId,
    userName: ctx.userName,
    action: "delete",
    entityType: "budget",
    entityId: budgetId,
    summary: "Deleted a budget line",
  });
}

export function periodRangeForBudget(periodType: string, year: number, periodIndex: number): { from: string; to: string } {
  if (periodType === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (periodType === "quarter") {
    const startMonth = (periodIndex - 1) * 3 + 1;
    const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
    const endMonth = startMonth + 2;
    return { from, to: endOfMonth(`${year}-${String(endMonth).padStart(2, "0")}-01`) };
  }
  const from = `${year}-${String(periodIndex).padStart(2, "0")}-01`;
  return { from, to: endOfMonth(from) };
}

export function budgetVariance(
  companyId: number,
  filters: { year?: number; periodType?: string; periodIndex?: number } = {},
): {
  rows: {
    id: number;
    name: string;
    scope: string;
    periodType: string;
    year: number;
    periodIndex: number;
    budget: number;
    actual: number;
    variance: number;
    variancePct: number | null;
    usage: number | null;
    targetLabel: string;
  }[];
  totals: { budget: number; actual: number; variance: number };
} {
  const conditions = ["b.company_id = ?"];
  const params: unknown[] = [companyId];
  if (filters.year) {
    conditions.push("b.year = ?");
    params.push(filters.year);
  }
  if (filters.periodType && filters.periodType !== "all") {
    conditions.push("b.period_type = ?");
    params.push(filters.periodType);
  }
  if (filters.periodIndex) {
    conditions.push("b.period_index = ?");
    params.push(filters.periodIndex);
  }

  const budgets = all<{
    id: number;
    name: string;
    scope: string;
    period_type: string;
    year: number;
    period_index: number;
    department_id: number | null;
    category_id: number | null;
    account_id: number | null;
    amount: number;
    department_name: string | null;
    category_name: string | null;
    account_code: string | null;
    account_name: string | null;
  }>(
    `SELECT b.*, d.name AS department_name, c.name AS category_name, a.code AS account_code, a.name AS account_name
       FROM budgets b
       LEFT JOIN departments d ON d.id = b.department_id
       LEFT JOIN categories c ON c.id = b.category_id
       LEFT JOIN accounts a ON a.id = b.account_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY b.year DESC, b.period_type, b.period_index`,
    params,
  );

  const rows = budgets.map((budget) => {
    const range = periodRangeForBudget(budget.period_type, budget.year, budget.period_index);
    let actual = 0;

    if (budget.account_id) {
      const row = one<{ net: number }>(
        `SELECT COALESCE(SUM(l.base_debit - l.base_credit),0) AS net
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
          WHERE l.company_id = ? AND l.account_id = ? AND e.status = 'posted' AND e.date BETWEEN ? AND ?`,
        [companyId, budget.account_id, range.from, range.to],
      );
      actual = row?.net ?? 0;
    } else if (budget.category_id) {
      const accounts = all<{ account_id: number }>("SELECT account_id FROM categories WHERE id = ?", [budget.category_id]);
      const accountId = accounts[0]?.account_id ?? null;
      const row = accountId
        ? one<{ net: number }>(
            `SELECT COALESCE(SUM(l.base_debit - l.base_credit),0) AS net
               FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
              WHERE l.company_id = ? AND l.account_id = ? AND e.status = 'posted' AND e.date BETWEEN ? AND ?`,
            [companyId, accountId, range.from, range.to],
          )
        : undefined;
      actual = row?.net ?? 0;
    } else if (budget.department_id) {
      const row = one<{ net: number }>(
        `SELECT COALESCE(SUM(l.base_debit - l.base_credit),0) AS net
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
          WHERE l.company_id = ? AND l.department_id = ? AND a.type IN ('expense','cogs','other_expense')
            AND e.status = 'posted' AND e.date BETWEEN ? AND ?`,
        [companyId, budget.department_id, range.from, range.to],
      );
      actual = row?.net ?? 0;
    } else {
      const row = one<{ net: number }>(
        `SELECT COALESCE(SUM(l.base_debit - l.base_credit),0) AS net
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
          WHERE l.company_id = ? AND a.type IN ('expense','cogs','other_expense')
            AND e.status = 'posted' AND e.date BETWEEN ? AND ?`,
        [companyId, range.from, range.to],
      );
      actual = row?.net ?? 0;
    }

    const targetLabel =
      budget.scope === "department"
        ? (budget.department_name ?? "Department")
        : budget.scope === "category"
          ? (budget.category_name ?? "Category")
          : budget.scope === "account"
            ? `${budget.account_code ?? ""} ${budget.account_name ?? ""}`.trim()
            : "Company total";

    const variance = budget.amount - actual;
    return {
      id: budget.id,
      name: budget.name,
      scope: budget.scope,
      periodType: budget.period_type,
      year: budget.year,
      periodIndex: budget.period_index,
      budget: budget.amount,
      actual,
      variance,
      variancePct: budget.amount ? (variance / budget.amount) * 100 : null,
      usage: budget.amount ? (actual / budget.amount) * 100 : null,
      targetLabel,
    };
  });

  return {
    rows,
    totals: {
      budget: rows.reduce((sum, row) => sum + row.budget, 0),
      actual: rows.reduce((sum, row) => sum + row.actual, 0),
      variance: rows.reduce((sum, row) => sum + row.variance, 0),
    },
  };
}

/* --------------------------------------------------------- global search */
export type SearchHit = {
  type: "invoice" | "bill" | "expense" | "contact" | "product" | "employee" | "document" | "entry" | "account" | "bank";
  id: number;
  title: string;
  subtitle: string;
  href: string;
  amount?: number;
  currency?: string;
};

export function globalSearch(companyId: number, query: string, limit = 6): SearchHit[] {
  const term = query.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const hits: SearchHit[] = [];

  for (const row of all<{ id: number; number: string; name: string; total: number; currency: string; status: string }>(
    `SELECT i.id, i.number, c.name, i.total, i.currency, i.status FROM invoices i JOIN contacts c ON c.id = i.contact_id
      WHERE i.company_id = ? AND (i.number LIKE ? OR c.name LIKE ?) ORDER BY i.id DESC LIMIT ?`,
    [companyId, like, like, limit],
  )) {
    hits.push({ type: "invoice", id: row.id, title: `Invoice ${row.number}`, subtitle: `${row.name} · ${row.status}`, href: `/sales/invoices/${row.id}`, amount: row.total, currency: row.currency });
  }

  for (const row of all<{ id: number; number: string; name: string; total: number; currency: string; status: string }>(
    `SELECT b.id, b.number, c.name, b.total, b.currency, b.status FROM bills b JOIN contacts c ON c.id = b.contact_id
      WHERE b.company_id = ? AND (b.number LIKE ? OR c.name LIKE ?) ORDER BY b.id DESC LIMIT ?`,
    [companyId, like, like, limit],
  )) {
    hits.push({ type: "bill", id: row.id, title: `Bill ${row.number}`, subtitle: `${row.name} · ${row.status}`, href: `/purchases/bills/${row.id}`, amount: row.total, currency: row.currency });
  }

  for (const row of all<{ id: number; number: string; date: string; total: number; description: string | null }>(
    `SELECT id, number, date, amount + tax_amount AS total, description FROM expenses
      WHERE company_id = ? AND (number LIKE ? OR description LIKE ?) ORDER BY id DESC LIMIT ?`,
    [companyId, like, like, limit],
  )) {
    hits.push({ type: "expense", id: row.id, title: `Expense ${row.number}`, subtitle: `${row.date}${row.description ? ` · ${row.description.slice(0, 40)}` : ""}`, href: `/purchases/expenses`, amount: row.total, currency: "UZS" });
  }

  for (const row of all<{ id: number; name: string; kind: string; tax_id: string | null }>(
    `SELECT id, name, kind, tax_id FROM contacts WHERE company_id = ? AND (name LIKE ? OR tax_id LIKE ? OR legal_name LIKE ?) ORDER BY name LIMIT ?`,
    [companyId, like, like, like, limit],
  )) {
    hits.push({ type: "contact", id: row.id, title: row.name, subtitle: `${row.kind}${row.tax_id ? ` · ${row.tax_id}` : ""}`, href: row.kind === "supplier" ? `/purchases/suppliers/${row.id}` : `/sales/customers/${row.id}` });
  }

  for (const row of all<{ id: number; name: string; sku: string; selling_price: number }>(
    `SELECT id, name, sku, selling_price FROM products WHERE company_id = ? AND (name LIKE ? OR sku LIKE ?) ORDER BY name LIMIT ?`,
    [companyId, like, like, limit],
  )) {
    hits.push({ type: "product", id: row.id, title: row.name, subtitle: `SKU ${row.sku}`, href: `/inventory/products`, amount: row.selling_price, currency: "UZS" });
  }

  for (const row of all<{ id: number; full_name: string; position: string | null; gross_salary: number }>(
    `SELECT id, full_name, position, gross_salary FROM employees WHERE company_id = ? AND full_name LIKE ? ORDER BY full_name LIMIT ?`,
    [companyId, like, limit],
  )) {
    hits.push({ type: "employee", id: row.id, title: row.full_name, subtitle: row.position ?? "Employee", href: `/employees/employees`, amount: row.gross_salary, currency: "UZS" });
  }

  for (const row of all<{ id: number; name: string; kind: string; created_at: string }>(
    `SELECT id, name, kind, created_at FROM documents WHERE company_id = ? AND (name LIKE ? OR detected_company LIKE ?) ORDER BY id DESC LIMIT ?`,
    [companyId, like, like, limit],
  )) {
    hits.push({ type: "document", id: row.id, title: row.name, subtitle: `${row.kind} · ${row.created_at.slice(0, 10)}`, href: `/documents/${row.id}` });
  }

  for (const row of all<{ id: number; number: string; date: string; memo: string | null; total_debit: number }>(
    `SELECT id, number, date, memo, total_debit FROM journal_entries
      WHERE company_id = ? AND status = 'posted' AND (number LIKE ? OR memo LIKE ?) ORDER BY id DESC LIMIT ?`,
    [companyId, like, like, limit],
  )) {
    hits.push({ type: "entry", id: row.id, title: `Journal entry ${row.number}`, subtitle: `${row.date}${row.memo ? ` · ${row.memo.slice(0, 40)}` : ""}`, href: `/accounting/journal-entries/${row.id}`, amount: row.total_debit, currency: "UZS" });
  }

  for (const row of all<{ id: number; code: string; name: string; type: string }>(
    `SELECT id, code, name, type FROM accounts WHERE company_id = ? AND (code LIKE ? OR name LIKE ?) ORDER BY code LIMIT ?`,
    [companyId, like, like, limit],
  )) {
    hits.push({ type: "account", id: row.id, title: `${row.code} ${row.name}`, subtitle: `${row.type} account`, href: `/accounting/chart-of-accounts` });
  }

  for (const row of all<{ id: number; description: string; date: string; amount: number; direction: string }>(
    `SELECT id, description, date, amount, direction FROM bank_transactions
      WHERE company_id = ? AND (description LIKE ? OR counterparty LIKE ? OR reference LIKE ?) ORDER BY id DESC LIMIT ?`,
    [companyId, like, like, like, limit],
  )) {
    hits.push({
      type: "bank",
      id: row.id,
      title: row.description.slice(0, 60),
      subtitle: `${row.date} · ${row.direction === "in" ? "incoming" : "outgoing"}`,
      href: "/banking/transactions",
      amount: row.amount,
      currency: "UZS",
    });
  }

  return hits.slice(0, 30);
}

export { diffDays, expenseBreakdown };
