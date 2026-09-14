import type { IconName } from "@/components/ui/icon";

/** Navigation model: one definition drives the sidebar, mobile menu and command palette. */
export type NavItem = {
  key: string;
  href: string;
  labelKey: string;
  icon: IconName;
  badgeKey?: "myWork" | "notifications" | "xato" | "documents";
  permission?: "view" | "manage_accounting" | "manage_users" | "manage_reports" | "approve";
};

export type NavSection = { key: string; labelKey: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    key: "main",
    labelKey: "nav.sectionMain",
    items: [
      { key: "dashboard", href: "/dashboard", labelKey: "nav.dashboard", icon: "dashboard" },
      { key: "my-work", href: "/my-work", labelKey: "nav.myWork", icon: "work", badgeKey: "myWork" },
    ],
  },
  {
    key: "accounting",
    labelKey: "nav.accounting",
    items: [
      { key: "transactions", href: "/accounting/transactions", labelKey: "nav.transactions", icon: "list" },
      { key: "journal-entries", href: "/accounting/journal-entries", labelKey: "nav.journalEntries", icon: "ledger" },
      { key: "chart-of-accounts", href: "/accounting/chart-of-accounts", labelKey: "nav.chartOfAccounts", icon: "layers", permission: "manage_accounting" },
      { key: "general-ledger", href: "/accounting/general-ledger", labelKey: "nav.generalLedger", icon: "report" },
      { key: "trial-balance", href: "/accounting/trial-balance", labelKey: "nav.trialBalance", icon: "scale" },
    ],
  },
  {
    key: "sales",
    labelKey: "nav.sales",
    items: [
      { key: "invoices", href: "/sales/invoices", labelKey: "nav.invoices", icon: "invoice" },
      { key: "customers", href: "/sales/customers", labelKey: "nav.customers", icon: "users" },
      { key: "payments", href: "/sales/payments", labelKey: "nav.payments", icon: "wallet" },
      { key: "receivables", href: "/sales/receivables", labelKey: "nav.receivables", icon: "clock" },
    ],
  },
  {
    key: "purchases",
    labelKey: "nav.purchases",
    items: [
      { key: "bills", href: "/purchases/bills", labelKey: "nav.bills", icon: "invoice" },
      { key: "suppliers", href: "/purchases/suppliers", labelKey: "nav.suppliers", icon: "truck" },
      { key: "expenses", href: "/purchases/expenses", labelKey: "nav.expenses", icon: "receipt" },
      { key: "payables", href: "/purchases/payables", labelKey: "nav.payables", icon: "clock" },
    ],
  },
  {
    key: "banking",
    labelKey: "nav.banking",
    items: [
      { key: "bank-accounts", href: "/banking/accounts", labelKey: "nav.bankAccounts", icon: "bank" },
      { key: "bank-transactions", href: "/banking/transactions", labelKey: "nav.bankTransactions", icon: "list" },
      { key: "reconciliation", href: "/banking/reconciliation", labelKey: "nav.reconciliation", icon: "refresh" },
    ],
  },
  {
    key: "inventory",
    labelKey: "nav.inventory",
    items: [
      { key: "products", href: "/inventory/products", labelKey: "nav.products", icon: "box" },
      { key: "stock", href: "/inventory/stock", labelKey: "nav.stock", icon: "layers" },
      { key: "warehouses", href: "/inventory/warehouses", labelKey: "nav.warehouses", icon: "warehouse" },
      { key: "movements", href: "/inventory/movements", labelKey: "nav.movements", icon: "flow" },
    ],
  },
  {
    key: "employees",
    labelKey: "nav.employees",
    items: [
      { key: "employees", href: "/employees/employees", labelKey: "nav.employees", icon: "user" },
      { key: "payroll", href: "/employees/payroll", labelKey: "nav.payroll", icon: "wallet" },
      { key: "advances", href: "/employees/advances", labelKey: "nav.advances", icon: "wallet" },
    ],
  },
  {
    key: "documents",
    labelKey: "nav.documents",
    items: [
      { key: "all-documents", href: "/documents", labelKey: "nav.allDocuments", icon: "document" },
      { key: "scanner", href: "/documents/scanner", labelKey: "nav.aiScanner", icon: "scan" },
      { key: "contracts", href: "/documents?kind=contract", labelKey: "nav.contracts", icon: "contract" },
      { key: "receipts", href: "/documents?kind=receipt", labelKey: "nav.receipts", icon: "receipt" },
      { key: "bank-statements", href: "/documents?kind=statement", labelKey: "nav.bankStatements", icon: "statement" },
    ],
  },
  {
    key: "reports",
    labelKey: "nav.reports",
    items: [
      { key: "profit-loss", href: "/reports/profit-loss", labelKey: "nav.profitLoss", icon: "chart" },
      { key: "balance-sheet", href: "/reports/balance-sheet", labelKey: "nav.balanceSheet", icon: "scale" },
      { key: "cash-flow", href: "/reports/cash-flow", labelKey: "nav.cashFlow", icon: "flow" },
      { key: "trial-balance-report", href: "/accounting/trial-balance", labelKey: "nav.trialBalance", icon: "report" },
      { key: "general-ledger-report", href: "/accounting/general-ledger", labelKey: "nav.generalLedger", icon: "ledger" },
      { key: "receivables-report", href: "/reports/receivables", labelKey: "nav.receivablesReport", icon: "clock" },
      { key: "payables-report", href: "/reports/payables", labelKey: "nav.payablesReport", icon: "clock" },
      { key: "tax-reports", href: "/reports/tax-report", labelKey: "nav.taxReports", icon: "shield" },
      { key: "management-reports", href: "/reports/management-reports", labelKey: "nav.managementReports", icon: "target" },
    ],
  },
  {
    key: "intelligence",
    labelKey: "nav.sectionIntelligence",
    items: [
      { key: "ai-accountant", href: "/ai-center/accountant", labelKey: "nav.aiAccountant", icon: "brain" },
      { key: "ai-cfo", href: "/ai-center/cfo", labelKey: "nav.aiCfo", icon: "sparkles" },
      { key: "advisor", href: "/ai-center/advisor", labelKey: "nav.businessAdvisor", icon: "target" },
      { key: "xato-radar", href: "/ai-center/xato-radar", labelKey: "nav.xatoRadar", icon: "radar", badgeKey: "xato" },
      { key: "budgeting", href: "/budgeting", labelKey: "nav.budgeting", icon: "target" },
      { key: "tax-center", href: "/tax-center", labelKey: "nav.taxCenter", icon: "shield" },
      { key: "month-end-close", href: "/month-end-close", labelKey: "nav.monthEndClose", icon: "checkCircle" },
    ],
  },
  {
    key: "workspace",
    labelKey: "nav.sectionSetup",
    items: [
      { key: "notifications", href: "/notifications", labelKey: "nav.notifications", icon: "bell", badgeKey: "notifications" },
      { key: "team", href: "/settings/team", labelKey: "nav.team", icon: "users", permission: "manage_users" },
      { key: "audit-log", href: "/settings/audit-log", labelKey: "nav.auditLog", icon: "shield" },
      { key: "settings", href: "/settings", labelKey: "nav.settings", icon: "settings" },
    ],
  },
];

export const MOBILE_NAV: NavItem[] = [
  { key: "dashboard", href: "/dashboard", labelKey: "nav.dashboard", icon: "dashboard" },
  { key: "invoices", href: "/sales/invoices", labelKey: "nav.invoices", icon: "invoice" },
  { key: "transactions", href: "/accounting/transactions", labelKey: "nav.transactions", icon: "list" },
  { key: "reports", href: "/reports/profit-loss", labelKey: "nav.reports", icon: "chart" },
  { key: "more", href: "/settings", labelKey: "nav.settings", icon: "grid" },
];

export function findNavItem(pathname: string): NavItem | undefined {
  const all = NAV_SECTIONS.flatMap((section) => section.items);
  return all
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`) || (item.href.includes("?") && pathname.startsWith(item.href.split("?")[0])))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
