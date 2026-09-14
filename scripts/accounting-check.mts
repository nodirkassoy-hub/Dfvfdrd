/**
 * Accounting consistency acceptance test (§39).
 *
 * Proves, against a real database, that:
 *   1. Revenue 100M and expenses 60M produce a profit of 40M — in the ledger,
 *      in the reports and in what the AI answers.
 *   2. Adding a 10M expense moves profit to 30M everywhere at once.
 *   3. An unpaid invoice increases receivables; marking it paid decreases them.
 *   4. A duplicated expense is detected by Xato Radar.
 *   5. Every posted entry balances, and dashboard = reports = AI.
 *
 * Runs on its own temporary database so it never touches real data.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "buxai-check-"));
process.env.BUXAI_DB_PATH = path.join(tmp, "check.db");

const { closeDb } = await import("@/lib/db");
const { createCompany } = await import("@/lib/services/company");
const { createContact } = await import("@/lib/services/contacts");
const { createInvoice, sendInvoice, recordInvoicePayment } = await import("@/lib/services/sales");
const { createExpense } = await import("@/lib/services/purchases");
const { incomeStatement, accountsReceivable, trialBalance, cashBalance } = await import("@/lib/accounting/ledger");
const { dashboardData } = await import("@/lib/services/dashboard");
const { answerQuestion } = await import("@/lib/services/intelligence");
const { runXatoRadar, listAlerts } = await import("@/lib/services/operations");
const { resolvePeriod, todayISO } = await import("@/lib/dates");
const { formatMoney } = await import("@/lib/money");

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${label}${ok ? "" : `  (expected ${String(expected)}, got ${String(actual)})`}`);
}

function checkTrue(label: string, value: boolean) {
  check(label, value, true);
}

/* UZS is stored with zero decimals, so "1M" is exactly one million minor units. */
const M = (value: number) => value * 1_000_000;
const UZS = (minor: number) => formatMoney(minor, { currency: "UZS", showCode: true, locale: "en" });
void UZS;

console.log("BUXAI — accounting consistency check (§39)\n");

const userId = (await import("@/lib/db")).insert(
  "INSERT INTO users (email, name, password_hash, password_salt, locale, theme, created_at) VALUES (?, ?, ?, ?, 'en', 'light', ?)",
  ["check@buxai.test", "Check User", "x", "y", todayISO()],
);
const companyId = createCompany({
  name: "Check Co",
  legalName: "Check Co LLC",
  baseCurrency: "UZS",
  locale: "en",
  userId,
  role: "owner",
});
const bank = (await import("@/lib/db")).one<{ id: number; account_id: number }>(
  "SELECT id, account_id FROM bank_accounts WHERE company_id = ? AND kind = 'bank' ORDER BY id LIMIT 1",
  [companyId],
)!;
const customerId = createContact({ companyId, kind: "customer", name: "Customer A", currency: "UZS" });
const supplierId = createContact({ companyId, kind: "supplier", name: "Supplier B", currency: "UZS" });
const expenseAccount = (await import("@/lib/db")).one<{ id: number }>(
  "SELECT id FROM accounts WHERE company_id = ? AND code = '6110'",
  [companyId],
)!;
const ctx = { userId, userName: "Check User" };

/* ---------------------------------------------------- 1. revenue 100M */
const invoiceId = createInvoice(
  {
    companyId,
    contactId: customerId,
    issueDate: todayISO(),
    dueDate: todayISO(),
    currency: "UZS",
    lines: [{ description: "Consulting services", qtyMilli: 1000, unitPrice: M(100) / 1, taxRateBp: 0 }],
  },
  ctx,
);
sendInvoice(companyId, invoiceId, ctx);

const period = resolvePeriod("this_month", { today: todayISO(), locale: "en" });
let is = incomeStatement(companyId, period.from, period.to, period.previousFrom, period.previousTo);

console.log("\n1) Revenue 100M posted");
check("revenue = 100,000,000 UZS", is.revenue.total, M(100));
check("expenses = 0", is.cogs.total + is.operatingExpenses.total + is.otherExpenses.total, 0);
check("net profit = revenue - expenses", is.netProfit, is.revenue.total - (is.cogs.total + is.operatingExpenses.total + is.otherExpenses.total));

/* ------------------------------------------- 2. expenses 60M → profit 40M */
createExpense(
  { companyId, date: todayISO(), accountId: expenseAccount.id, paymentAccountId: bank.id, amount: M(60), description: "Operating costs", isPaid: true },
  ctx,
);

is = incomeStatement(companyId, period.from, period.to, period.previousFrom, period.previousTo);
console.log("\n2) Expenses 60M posted");
check("revenue still 100,000,000", is.revenue.total, M(100));
check("expenses = 60,000,000", is.cogs.total + is.operatingExpenses.total + is.otherExpenses.total, M(60));
check("net profit = 40,000,000", is.netProfit, M(40));

/* ------------------------------------------ 3. add 10M → profit 30M */
createExpense(
  { companyId, date: todayISO(), accountId: expenseAccount.id, paymentAccountId: bank.id, amount: M(10), description: "Additional expense", isPaid: true },
  ctx,
);
is = incomeStatement(companyId, period.from, period.to, period.previousFrom, period.previousTo);
console.log("\n3) Additional 10M expense posted");
check("expenses = 70,000,000", is.cogs.total + is.operatingExpenses.total + is.otherExpenses.total, M(70));
check("net profit = 30,000,000", is.netProfit, M(30));

/* ----------------------------------- 4. unpaid invoice → receivables up */
const secondInvoice = createInvoice(
  {
    companyId,
    contactId: customerId,
    issueDate: todayISO(),
    dueDate: todayISO(),
    currency: "UZS",
    lines: [{ description: "Licence fee", qtyMilli: 1000, unitPrice: M(25), taxRateBp: 0 }],
  },
  ctx,
);
sendInvoice(companyId, secondInvoice, ctx);
const arBefore = Math.abs(accountsReceivable(companyId, todayISO()));
console.log("\n4) Unpaid invoice issued");
check("receivables include the unpaid invoice", arBefore, M(125));

recordInvoicePayment({ companyId, invoiceId: secondInvoice, amount: M(25), date: todayISO(), bankAccountId: bank.id }, ctx);
const arAfter = Math.abs(accountsReceivable(companyId, todayISO()));
console.log("\n   invoice marked paid");
check("receivables decrease by the payment", arAfter, M(100));
checkTrue("receivables went down after payment", arAfter < arBefore);

/* ---------------------------------- 5. duplicate expense → Xato Radar */
createExpense(
  { companyId, date: todayISO(), accountId: expenseAccount.id, paymentAccountId: bank.id, amount: M(10), description: "Additional expense", isPaid: true },
  ctx,
);
const radar = runXatoRadar(companyId, period, ctx);
const alerts = listAlerts(companyId, { limit: 200 });
const duplicateAlert = alerts.find((alert) => alert.type === "duplicate_transaction");
console.log("\n5) Duplicate expense posted, radar re-run");
checkTrue("radar produced findings", radar.total > 0);
checkTrue("duplicate expense detected", Boolean(duplicateAlert));
checkTrue("duplicate alert explains the problem", Boolean(duplicateAlert?.whyProblem && duplicateAlert?.howToFix));

/* ------------------------------- 6. dashboard = reports = AI numbers */
is = incomeStatement(companyId, period.from, period.to, period.previousFrom, period.previousTo);
const dashboard = dashboardData(companyId, period, "UZS");
const dashboardProfit = dashboard.kpis.find((kpi) => kpi.key === "netProfit")?.value;
const dashboardRevenue = dashboard.kpis.find((kpi) => kpi.key === "revenue")?.value;
console.log("\n6) Dashboard, report and AI agreement");
check("dashboard revenue = report revenue", dashboardRevenue, is.revenue.total);
check("dashboard profit = report profit", dashboardProfit, is.netProfit);

const answer = answerQuestion(
  { companyId, companyName: "Check Co", currency: "UZS", locale: "en", period },
  "What was my profit this month?",
);
const figure = answer.figures.find((item) => item.label.toLowerCase().includes("profit"));
checkTrue("AI answered from ledger data", answer.figures.length > 0);
check("AI profit figure = report profit", figure?.value, is.netProfit);

/* ------------------------------------------------ 7. ledger integrity */
const trial = trialBalance(companyId, period.from, period.to);
console.log("\n7) Ledger integrity");
checkTrue("trial balance is balanced", trial.balanced);
check("total debits equal total credits", trial.totals.debit, trial.totals.credit);

const unbalanced = (await import("@/lib/db")).all<{ id: number; debit: number; credit: number }>(
  `SELECT * FROM (
     SELECT e.id AS id, COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
       FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
      WHERE e.company_id = ? AND e.status = 'posted' GROUP BY e.id
   ) WHERE debit <> credit`,
  [companyId],
);
check("no unbalanced journal entry exists", unbalanced.length, 0);

/* ------- 8. every dashboard figure equals the ledger-derived report */
console.log("\n8) Cross-check of dashboard KPIs against the ledger");
const cash = cashBalance(companyId, todayISO());
check("dashboard cash = ledger cash", dashboard.kpis.find((kpi) => kpi.key === "cash")?.value, cash);
check("dashboard receivables = ledger AR", dashboard.kpis.find((kpi) => kpi.key === "receivable")?.value, Math.abs(accountsReceivable(companyId, todayISO())));

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exitCode = 1;
} else {
  console.log("Accounting engine is consistent: ledger = reports = dashboard = AI.");
}

closeDb();
fs.rmSync(tmp, { recursive: true, force: true });
