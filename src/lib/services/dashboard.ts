/**
 * Dashboard aggregation. One call returns every figure the overview needs, all
 * of it derived from `journal_lines` — the same source the reports and the AI
 * Center read, so the dashboard can never disagree with a report.
 */
import { all, one } from "@/lib/db";
import {
  accountsPayable,
  accountsReceivable,
  cashBalance,
  expenseBreakdown,
  incomeStatement,
  monthlySeries,
  receivablesAging,
  topContactsByRevenue,
  trialBalance,
} from "@/lib/accounting/ledger";
import { formatDate, todayISO, type Period } from "@/lib/dates";
import { percentChange } from "@/lib/money";
import { cashForecast, financialHealth, type CashForecast, type HealthScore } from "./intelligence";
import { alertStats, listAlerts, unreadNotificationCount, taskStats } from "./operations";

export type Kpi = {
  key: "revenue" | "expenses" | "netProfit" | "cash" | "receivable" | "payable";
  labelKey: string;
  value: number;
  previous: number | null;
  changePct: number | null;
  goodDirection: "up" | "down";
  drill: { href: string; type?: string };
};

export type DashboardData = {
  period: Period;
  kpis: Kpi[];
  series: ReturnType<typeof monthlySeries>;
  expenseBreakdown: ReturnType<typeof expenseBreakdown>;
  topCustomers: ReturnType<typeof topContactsByRevenue>;
  outstandingInvoices: {
    id: number;
    number: string;
    customerName: string;
    dueDate: string;
    amountDue: number;
    daysOverdue: number;
    status: string;
  }[];
  upcomingPayments: { label: string; date: string; amount: number; href: string }[];
  health: HealthScore;
  alerts: ReturnType<typeof listAlerts>;
  alertSummary: ReturnType<typeof alertStats>;
  aging: ReturnType<typeof receivablesAging>;
  forecast: CashForecast;
  lowStock: { id: number; name: string; sku: string; qtyMilli: number; minStockMilli: number; unit: string }[];
  recentEntries: {
    id: number;
    number: string;
    date: string;
    memo: string | null;
    sourceType: string;
    amount: number;
    debitAccount: string;
    creditAccount: string;
  }[];
  integrity: { balanced: boolean; difference: number; entries: number };
  badges: { tasks: number; notifications: number; alerts: number; documents: number };
  counts: { invoices: number; customers: number; products: number; employees: number };
};

export function dashboardData(companyId: number, period: Period, currency: string): DashboardData {
  const is = incomeStatement(companyId, period.from, period.to, period.previousFrom, period.previousTo);
  const cash = cashBalance(companyId, period.to);
  const cashPrevious = cashBalance(companyId, period.previousTo);
  const ar = Math.abs(accountsReceivable(companyId, period.to));
  const arPrevious = Math.abs(accountsReceivable(companyId, period.previousTo));
  const ap = Math.abs(accountsPayable(companyId, period.to));
  const apPrevious = Math.abs(accountsPayable(companyId, period.previousTo));

  const expensesTotal = is.cogs.total + is.operatingExpenses.total + is.otherExpenses.total;
  const expensesPrevious = is.cogs.previousTotal + is.operatingExpenses.previousTotal + is.otherExpenses.previousTotal;

  const kpis: Kpi[] = [
    {
      key: "revenue",
      labelKey: "dash.revenue",
      value: is.revenue.total,
      previous: is.revenue.previousTotal,
      changePct: percentChange(is.revenue.total, is.revenue.previousTotal),
      goodDirection: "up",
      drill: { href: "/reports/profit-loss?drill=revenue", type: "revenue" },
    },
    {
      key: "expenses",
      labelKey: "dash.expenses",
      value: expensesTotal,
      previous: expensesPrevious,
      changePct: percentChange(expensesTotal, expensesPrevious),
      goodDirection: "down",
      drill: { href: "/reports/expense-report?drill=expenses", type: "expense" },
    },
    {
      key: "netProfit",
      labelKey: "dash.netProfit",
      value: is.netProfit,
      previous: is.netProfitPrevious,
      changePct: percentChange(is.netProfit, is.netProfitPrevious),
      goodDirection: "up",
      drill: { href: "/reports/profit-loss", type: "netProfit" },
    },
    {
      key: "cash",
      labelKey: "dash.cash",
      value: cash,
      previous: cashPrevious,
      changePct: percentChange(cash, cashPrevious),
      goodDirection: "up",
      drill: { href: "/banking/accounts", type: "cash" },
    },
    {
      key: "receivable",
      labelKey: "dash.receivable",
      value: ar,
      previous: arPrevious,
      changePct: percentChange(ar, arPrevious),
      goodDirection: "down",
      drill: { href: "/reports/receivables", type: "receivable" },
    },
    {
      key: "payable",
      labelKey: "dash.payable",
      value: ap,
      previous: apPrevious,
      changePct: percentChange(ap, apPrevious),
      goodDirection: "down",
      drill: { href: "/reports/payables", type: "payable" },
    },
  ];

  const series = monthlySeries(companyId, period.from, period.to);
  const breakdown = expenseBreakdown(companyId, period.from, period.to, period.previousFrom, period.previousTo);
  const customers = topContactsByRevenue(companyId, period.from, period.to, period.previousFrom, period.previousTo, 6);

  const outstandingInvoices = all<{
    id: number;
    number: string;
    customerName: string;
    dueDate: string;
    amountDue: number;
    daysOverdue: number;
    status: string;
  }>(
    `SELECT i.id, i.number, c.name AS customerName, i.due_date AS dueDate, i.total - i.amount_paid AS amountDue,
            CASE WHEN i.due_date < date('now') THEN CAST(julianday(date('now')) - julianday(i.due_date) AS INTEGER) ELSE 0 END AS daysOverdue,
            i.status
       FROM invoices i JOIN contacts c ON c.id = i.contact_id
      WHERE i.company_id = ? AND i.status IN ('sent','partially_paid','overdue') AND i.total > i.amount_paid
      ORDER BY i.due_date ASC LIMIT 6`,
    [companyId],
  );

  const upcomingBills = all<{ id: number; number: string; supplierName: string; dueDate: string; amountDue: number }>(
    `SELECT b.id, b.number, c.name AS supplierName, b.due_date AS dueDate, b.total - b.amount_paid AS amountDue
       FROM bills b JOIN contacts c ON c.id = b.contact_id
      WHERE b.company_id = ? AND b.status IN ('open','partially_paid','overdue') AND b.total > b.amount_paid
      ORDER BY b.due_date ASC LIMIT 5`,
    [companyId],
  );
  const upcomingTaxes = all<{ id: number; name: string; dueDate: string; amount: number; paidAmount: number }>(
    `SELECT id, name, due_date AS dueDate, amount, paid_amount AS paidAmount FROM tax_obligations
      WHERE company_id = ? AND status <> 'paid' ORDER BY due_date ASC LIMIT 5`,
    [companyId],
  );

  const upcomingPayments = [
    ...upcomingBills.map((bill) => ({
      label: `Bill ${bill.number} — ${bill.supplierName}`,
      date: bill.dueDate,
      amount: bill.amountDue,
      href: `/purchases/bills/${bill.id}`,
    })),
    ...upcomingTaxes.map((tax) => ({
      label: tax.name,
      date: tax.dueDate,
      amount: Math.max(0, tax.amount - tax.paidAmount),
      href: "/tax-center",
    })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  const health = financialHealth(companyId, period);
  const alerts = listAlerts(companyId, { status: "open", limit: 5 });
  const alertSummary = alertStats(companyId);
  const aging = receivablesAging(companyId, period.to);
  const forecast = cashForecast(companyId, 90, period.to);

  const lowStock = all<{ id: number; name: string; sku: string; qtyMilli: number; minStockMilli: number; unit: string }>(
    `SELECT * FROM (SELECT p.id, p.name, p.sku, p.unit,
            COALESCE((SELECT SUM(qty_milli) FROM v_stock_balances b WHERE b.product_id = p.id), 0) AS qtyMilli,
            p.min_stock_milli AS minStockMilli
       FROM products p
      WHERE p.company_id = ? AND p.is_archived = 0 AND p.min_stock_milli > 0
      ) WHERE qtyMilli <= minStockMilli
      ORDER BY (CAST(qtyMilli AS REAL) / NULLIF(minStockMilli,0)) ASC LIMIT 5`,
    [companyId],
  );

  const recentEntries = all<{
    id: number;
    number: string;
    date: string;
    memo: string | null;
    sourceType: string;
    amount: number;
    debitAccount: string;
    creditAccount: string;
  }>(
    `SELECT e.id, e.number, e.date, e.memo, e.source_type AS sourceType, e.total_debit AS amount,
            COALESCE((SELECT GROUP_CONCAT(a.code || ' ' || a.name, ', ') FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                       WHERE l.entry_id = e.id AND l.debit > 0 ORDER BY l.line_no), '—') AS debitAccount,
            COALESCE((SELECT GROUP_CONCAT(a.code || ' ' || a.name, ', ') FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                       WHERE l.entry_id = e.id AND l.credit > 0 ORDER BY l.line_no), '—') AS creditAccount
       FROM journal_entries e
      WHERE e.company_id = ? AND e.status = 'posted'
      ORDER BY e.date DESC, e.id DESC LIMIT 8`,
    [companyId],
  );

  const control = trialBalance(companyId, period.from, period.to);
  const taskSummary = taskStats(companyId);

  const badges = {
    tasks: taskSummary.todo + taskSummary.inProgress,
    notifications: unreadNotificationCount(companyId),
    alerts: alertSummary.open,
    documents:
      one<{ count: number }>("SELECT COUNT(*) AS count FROM documents WHERE company_id = ? AND status = 'needs_review'", [companyId])?.count ?? 0,
  };

  const counts = {
    invoices: one<{ count: number }>("SELECT COUNT(*) AS count FROM invoices WHERE company_id = ?", [companyId])?.count ?? 0,
    customers:
      one<{ count: number }>("SELECT COUNT(*) AS count FROM contacts WHERE company_id = ? AND kind IN ('customer','both')", [companyId])?.count ?? 0,
    products: one<{ count: number }>("SELECT COUNT(*) AS count FROM products WHERE company_id = ? AND is_archived = 0", [companyId])?.count ?? 0,
    employees: one<{ count: number }>("SELECT COUNT(*) AS count FROM employees WHERE company_id = ?", [companyId])?.count ?? 0,
  };

  void currency;
  return {
    period,
    kpis,
    series,
    expenseBreakdown: breakdown.slice(0, 6),
    topCustomers: customers,
    outstandingInvoices,
    upcomingPayments,
    health,
    alerts,
    alertSummary,
    aging,
    forecast,
    lowStock,
    recentEntries,
    integrity: {
      balanced: control.balanced,
      difference: control.totals.debit - control.totals.credit,
      entries: control.rows.length,
    },
    badges,
    counts,
  };
}

export function greetingKey(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "dash.greetingMorning";
  if (hour < 18) return "dash.greetingDay";
  return "dash.greetingEvening";
}

export function navBadges(companyId: number) {
  const taskSummary = taskStats(companyId);
  const documents = one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM documents WHERE company_id = ? AND status = 'needs_review'",
    [companyId],
  );
  return {
    myWork: taskSummary.todo + taskSummary.inProgress,
    notifications: unreadNotificationCount(companyId),
    xato: alertStats(companyId).open,
    documents: documents?.count ?? 0,
  };
}

export function activityFeedDate(date: string): string {
  return formatDate(date);
}

export function horizonLabel(days: number, locale: "uz" | "ru" | "en"): string {
  if (locale === "ru") return `${days} дней`;
  if (locale === "uz") return `${days} kun`;
  return `${days} days`;
}

export { todayISO };
