/**
 * BUXAI database schema (SQLite).
 *
 * Design rules that the whole product depends on:
 *
 * 1. Every monetary column is an INTEGER count of minor units (tiyin/cents).
 *    No floating point in the ledger.
 * 2. Every financial event becomes a `journal_entries` row with two or more
 *    `journal_lines`. A CHECK constraint forbids a line from being both a debit
 *    and a credit, and the engine refuses to post an entry whose debits and
 *    credits do not sum exactly (in base currency and per transaction currency).
 * 3. Documents (invoices, bills, expenses, payments, payroll) reference the
 *    journal entry they produced, so any figure can be drilled back to source.
 * 4. Everything is scoped by `company_id`; there is no cross-company read path.
 * 5. Quantities are stored as milli-units (qty * 1000) integers.
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

/* ------------------------------------------------------------------ users */
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'uz',
  theme         TEXT NOT NULL DEFAULT 'light',
  avatar_color  TEXT NOT NULL DEFAULT 'indigo',
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS companies (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT NOT NULL,
  legal_name            TEXT,
  tax_id                TEXT,
  vat_number            TEXT,
  address               TEXT,
  director_name         TEXT,
  chief_accountant_name TEXT,
  phone                 TEXT,
  email                 TEXT,
  industry              TEXT,
  base_currency         TEXT NOT NULL DEFAULT 'UZS',
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1,
  tax_regime            TEXT NOT NULL DEFAULT 'vat',   -- vat | turnover | general
  vat_rate_bp           INTEGER NOT NULL DEFAULT 1200, -- 12.00%
  turnover_rate_bp      INTEGER NOT NULL DEFAULT 400,
  profit_tax_rate_bp    INTEGER NOT NULL DEFAULT 1500,
  social_rate_bp        INTEGER NOT NULL DEFAULT 1200,
  payroll_income_bp     INTEGER NOT NULL DEFAULT 1200,
  invoice_prefix        TEXT NOT NULL DEFAULT 'INV',
  brand_color           TEXT NOT NULL DEFAULT '#4F46E5',
  is_demo               INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'active',
  locked_through        TEXT,      -- accounting period closed through this date
  created_by            INTEGER REFERENCES users(id),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS company_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  invited_email TEXT,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'viewer',
  permissions   TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'active',
  invited_at    TEXT,
  accepted_at   TEXT,
  last_active_at TEXT,
  UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_company ON company_members(company_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON company_members(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

/* ----------------------------------------------------------- chart of accounts */
CREATE TABLE IF NOT EXISTS accounts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,     -- asset | liability | equity | revenue | cogs | expense | other_income | other_expense
  subtype      TEXT,
  parent_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  is_postable  INTEGER NOT NULL DEFAULT 1,
  currency     TEXT NOT NULL DEFAULT 'UZS',
  description  TEXT,
  is_system    INTEGER NOT NULL DEFAULT 0,
  is_archived  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_accounts_company ON accounts(company_id, type);

CREATE TABLE IF NOT EXISTS tax_codes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'vat',  -- vat | payroll | social | profit | turnover | other
  rate_bp       INTEGER NOT NULL DEFAULT 0,
  account_id    INTEGER REFERENCES accounts(id),
  is_active     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, code)
);

/* ---------------------------------------------------------------- contacts */
CREATE TABLE IF NOT EXISTS contacts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL DEFAULT 'customer', -- customer | supplier | both
  name               TEXT NOT NULL,
  legal_name         TEXT,
  tax_id             TEXT,
  contact_person     TEXT,
  phone              TEXT,
  email              TEXT,
  address            TEXT,
  bank_name          TEXT,
  bank_account       TEXT,
  mfo                TEXT,
  currency           TEXT NOT NULL DEFAULT 'UZS',
  payment_terms_days INTEGER NOT NULL DEFAULT 14,
  credit_limit       INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  is_archived        INTEGER NOT NULL DEFAULT 0,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id, kind);

/* --------------------------------------------------------------- inventory */
CREATE TABLE IF NOT EXISTS warehouses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  code       TEXT,
  address    TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'expense', -- expense | income | product
  account_id INTEGER REFERENCES accounts(id),
  parent_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_categories_company ON categories(company_id, kind);

CREATE TABLE IF NOT EXISTS products (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku                TEXT NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT,
  type               TEXT NOT NULL DEFAULT 'goods', -- goods | service
  category_id        INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  unit               TEXT NOT NULL DEFAULT 'pcs',
  purchase_price     INTEGER NOT NULL DEFAULT 0,
  selling_price      INTEGER NOT NULL DEFAULT 0,
  min_stock_milli    INTEGER NOT NULL DEFAULT 0,
  is_tracked         INTEGER NOT NULL DEFAULT 1,
  income_account_id  INTEGER REFERENCES accounts(id),
  expense_account_id INTEGER REFERENCES accounts(id),
  barcode            TEXT,
  is_archived        INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  UNIQUE (company_id, sku)
);

CREATE TABLE IF NOT EXISTS stock_moves (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
  date            TEXT NOT NULL,
  direction       TEXT NOT NULL,  -- in | out | transfer_in | transfer_out | adjust_in | adjust_out
  qty_milli       INTEGER NOT NULL,
  unit_cost       INTEGER NOT NULL DEFAULT 0,
  value           INTEGER NOT NULL DEFAULT 0,
  ref_type        TEXT,           -- bill | invoice | adjustment | transfer | opening
  ref_id          INTEGER,
  transfer_group  TEXT,
  note            TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_moves_product ON stock_moves(company_id, product_id, date);

/* ---------------------------------------------------------------- invoices */
CREATE TABLE IF NOT EXISTS invoices (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number            TEXT NOT NULL,
  contact_id        INTEGER NOT NULL REFERENCES contacts(id),
  issue_date        TEXT NOT NULL,
  due_date          TEXT NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'UZS',
  fx_rate_micro     INTEGER NOT NULL DEFAULT 1000000,
  status            TEXT NOT NULL DEFAULT 'draft', -- draft | sent | partially_paid | paid | overdue | cancelled
  subtotal          INTEGER NOT NULL DEFAULT 0,
  discount_total    INTEGER NOT NULL DEFAULT 0,
  tax_total         INTEGER NOT NULL DEFAULT 0,
  total             INTEGER NOT NULL DEFAULT 0,
  amount_paid       INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  terms             TEXT,
  warehouse_id      INTEGER REFERENCES warehouses(id),
  journal_entry_id  INTEGER REFERENCES journal_entries(id),
  source_document_id INTEGER,
  sent_at           TEXT,
  cancelled_at      TEXT,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id, issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_contact ON invoices(company_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(company_id, status);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL DEFAULT 1,
  product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description   TEXT NOT NULL,
  qty_milli     INTEGER NOT NULL DEFAULT 1000,
  unit_price    INTEGER NOT NULL DEFAULT 0,
  discount      INTEGER NOT NULL DEFAULT 0,
  tax_code_id   INTEGER REFERENCES tax_codes(id),
  tax_rate_bp   INTEGER NOT NULL DEFAULT 0,
  tax_amount    INTEGER NOT NULL DEFAULT 0,
  net_amount    INTEGER NOT NULL DEFAULT 0,
  line_total    INTEGER NOT NULL DEFAULT 0,
  account_id    INTEGER REFERENCES accounts(id),
  warehouse_id  INTEGER REFERENCES warehouses(id)
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines ON invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS bills (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number            TEXT NOT NULL,
  contact_id        INTEGER NOT NULL REFERENCES contacts(id),
  issue_date        TEXT NOT NULL,
  due_date          TEXT NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'UZS',
  fx_rate_micro     INTEGER NOT NULL DEFAULT 1000000,
  status            TEXT NOT NULL DEFAULT 'draft',
  subtotal          INTEGER NOT NULL DEFAULT 0,
  tax_total         INTEGER NOT NULL DEFAULT 0,
  total             INTEGER NOT NULL DEFAULT 0,
  amount_paid       INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  warehouse_id      INTEGER REFERENCES warehouses(id),
  journal_entry_id  INTEGER REFERENCES journal_entries(id),
  source_document_id INTEGER,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS idx_bills_company ON bills(company_id, issue_date);

CREATE TABLE IF NOT EXISTS bill_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id       INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL DEFAULT 1,
  product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description   TEXT NOT NULL,
  qty_milli     INTEGER NOT NULL DEFAULT 1000,
  unit_price    INTEGER NOT NULL DEFAULT 0,
  discount      INTEGER NOT NULL DEFAULT 0,
  tax_code_id   INTEGER REFERENCES tax_codes(id),
  tax_rate_bp   INTEGER NOT NULL DEFAULT 0,
  tax_amount    INTEGER NOT NULL DEFAULT 0,
  net_amount    INTEGER NOT NULL DEFAULT 0,
  line_total    INTEGER NOT NULL DEFAULT 0,
  account_id    INTEGER REFERENCES accounts(id),
  warehouse_id  INTEGER REFERENCES warehouses(id)
);
CREATE INDEX IF NOT EXISTS idx_bill_lines ON bill_lines(bill_id);

/* ---------------------------------------------------------------- payments */
CREATE TABLE IF NOT EXISTS payments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number            TEXT NOT NULL,
  kind              TEXT NOT NULL,               -- incoming | outgoing
  contact_id        INTEGER REFERENCES contacts(id),
  date              TEXT NOT NULL,
  amount            INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'UZS',
  fx_rate_micro     INTEGER NOT NULL DEFAULT 1000000,
  method            TEXT NOT NULL DEFAULT 'bank_transfer',
  account_id        INTEGER NOT NULL REFERENCES bank_accounts(id),
  invoice_id        INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  bill_id           INTEGER REFERENCES bills(id) ON DELETE SET NULL,
  expense_id        INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  reference         TEXT,
  notes             TEXT,
  journal_entry_id  INTEGER REFERENCES journal_entries(id),
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_company ON payments(company_id, date);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

/* ---------------------------------------------------------------- expenses */
CREATE TABLE IF NOT EXISTS expenses (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number             TEXT NOT NULL,
  date               TEXT NOT NULL,
  contact_id         INTEGER REFERENCES contacts(id),
  category_id        INTEGER REFERENCES categories(id),
  account_id         INTEGER NOT NULL REFERENCES accounts(id),
  payment_account_id INTEGER REFERENCES bank_accounts(id),
  amount             INTEGER NOT NULL,
  tax_amount         INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'UZS',
  fx_rate_micro      INTEGER NOT NULL DEFAULT 1000000,
  description        TEXT,
  reference          TEXT,
  status             TEXT NOT NULL DEFAULT 'posted', -- draft | posted
  is_paid            INTEGER NOT NULL DEFAULT 1,
  recurring          TEXT,
  source_document_id INTEGER,
  journal_entry_id   INTEGER REFERENCES journal_entries(id),
  ai_suggested       INTEGER NOT NULL DEFAULT 0,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_company ON expenses(company_id, date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(company_id, category_id);

/* ---------------------------------------------------------------- banking */
CREATE TABLE IF NOT EXISTS bank_accounts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'bank',  -- bank | cash
  bank_name        TEXT,
  account_number   TEXT,
  mfo              TEXT,
  currency         TEXT NOT NULL DEFAULT 'UZS',
  account_id       INTEGER NOT NULL REFERENCES accounts(id),
  opening_balance  INTEGER NOT NULL DEFAULT 0,
  is_default       INTEGER NOT NULL DEFAULT 0,
  is_archived      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id   INTEGER NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  date              TEXT NOT NULL,
  description       TEXT NOT NULL,
  counterparty      TEXT,
  reference         TEXT,
  direction         TEXT NOT NULL,               -- in | out
  amount            INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'UZS',
  fx_rate_micro     INTEGER NOT NULL DEFAULT 1000000,
  category_id       INTEGER REFERENCES categories(id),
  account_id        INTEGER REFERENCES accounts(id),
  contact_id        INTEGER REFERENCES contacts(id),
  status            TEXT NOT NULL DEFAULT 'unmatched', -- unmatched | matched | ignored
  match_confidence_bp INTEGER NOT NULL DEFAULT 0,
  matched_entry_id  INTEGER REFERENCES journal_entries(id),
  matched_type      TEXT,
  matched_id        INTEGER,
  journal_entry_id  INTEGER REFERENCES journal_entries(id),
  import_batch_id   INTEGER,
  external_id       TEXT,
  is_demo           INTEGER NOT NULL DEFAULT 0,
  matched_at        TEXT,
  matched_by        INTEGER REFERENCES users(id),
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL,
  UNIQUE (company_id, bank_account_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_bank_txn_company ON bank_transactions(company_id, date);
CREATE INDEX IF NOT EXISTS idx_bank_txn_status ON bank_transactions(company_id, status);

CREATE TABLE IF NOT EXISTS bank_txn_splits (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_txn_id    INTEGER NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  account_id     INTEGER NOT NULL REFERENCES accounts(id),
  category_id    INTEGER REFERENCES categories(id),
  amount         INTEGER NOT NULL,
  memo           TEXT
);

CREATE TABLE IF NOT EXISTS import_batches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source         TEXT NOT NULL,     -- csv | xlsx | pdf | statement | manual
  filename       TEXT NOT NULL,
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  rows_total     INTEGER NOT NULL DEFAULT 0,
  rows_imported  INTEGER NOT NULL DEFAULT 0,
  rows_skipped   INTEGER NOT NULL DEFAULT 0,
  detected_bank  TEXT,
  mapping        TEXT,
  document_id    INTEGER,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id   INTEGER NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  statement_date    TEXT NOT NULL,
  statement_balance INTEGER NOT NULL DEFAULT 0,
  ledger_balance    INTEGER NOT NULL DEFAULT 0,
  matched_count     INTEGER NOT NULL DEFAULT 0,
  unmatched_count   INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'in_progress',
  notes             TEXT,
  completed_at      TEXT,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL
);

/* -------------------------------------------------------------- documents */
CREATE TABLE IF NOT EXISTS documents (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'other', -- invoice | receipt | statement | contract | other
  mime               TEXT,
  size               INTEGER NOT NULL DEFAULT 0,
  storage_path       TEXT,
  status             TEXT NOT NULL DEFAULT 'uploaded', -- uploaded | analysing | needs_review | approved | archived | failed
  extracted          TEXT,
  extraction_engine  TEXT,
  extraction_confidence_bp INTEGER NOT NULL DEFAULT 0,
  page_count         INTEGER NOT NULL DEFAULT 1,
  detected_company   TEXT,
  detected_tax_id    TEXT,
  linked_type        TEXT,
  linked_id          INTEGER,
  posted_entry_id    INTEGER REFERENCES journal_entries(id),
  notes              TEXT,
  uploaded_by        INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id, created_at);

/* -------------------------------------------------------------- employees */
CREATE TABLE IF NOT EXISTS departments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name         TEXT NOT NULL,
  position          TEXT,
  department_id     INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  hire_date         TEXT,
  end_date          TEXT,
  gross_salary      INTEGER NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'UZS',
  tax_id            TEXT,
  inps_number       TEXT,
  bank_account      TEXT,
  phone             TEXT,
  email             TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  is_demo           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period          TEXT NOT NULL,           -- YYYY-MM
  status          TEXT NOT NULL DEFAULT 'draft', -- draft | approved | paid
  gross_total     INTEGER NOT NULL DEFAULT 0,
  tax_total       INTEGER NOT NULL DEFAULT 0,
  deduction_total INTEGER NOT NULL DEFAULT 0,
  net_total       INTEGER NOT NULL DEFAULT 0,
  social_total    INTEGER NOT NULL DEFAULT 0,
  account_id      INTEGER REFERENCES bank_accounts(id),
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL,
  UNIQUE (company_id, period)
);

CREATE TABLE IF NOT EXISTS payroll_lines (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_run_id    INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id       INTEGER NOT NULL REFERENCES employees(id),
  gross             INTEGER NOT NULL DEFAULT 0,
  bonus             INTEGER NOT NULL DEFAULT 0,
  income_tax        INTEGER NOT NULL DEFAULT 0,
  social            INTEGER NOT NULL DEFAULT 0,
  other_deduction   INTEGER NOT NULL DEFAULT 0,
  advance_deduction INTEGER NOT NULL DEFAULT 0,
  net               INTEGER NOT NULL DEFAULT 0,
  employee_account_id INTEGER REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON payroll_lines(payroll_run_id);

CREATE TABLE IF NOT EXISTS employee_advances (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id      INTEGER NOT NULL REFERENCES employees(id),
  date             TEXT NOT NULL,
  amount           INTEGER NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'UZS',
  payment_account_id INTEGER REFERENCES bank_accounts(id),
  deducted_in_run  INTEGER REFERENCES payroll_runs(id) ON DELETE SET NULL,
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  note             TEXT,
  created_by       INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL
);

/* ------------------------------------------------------------ accounting core */
CREATE TABLE IF NOT EXISTS journal_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number         TEXT NOT NULL,
  date           TEXT NOT NULL,
  memo           TEXT,
  status         TEXT NOT NULL DEFAULT 'posted', -- posted | void
  source_type    TEXT NOT NULL DEFAULT 'manual', -- manual | invoice | bill | payment | expense | payroll | bank | opening | depreciation | reversal | stock
  source_id      INTEGER,
  reference      TEXT,
  currency       TEXT NOT NULL DEFAULT 'UZS',
  total_debit    INTEGER NOT NULL DEFAULT 0,
  total_credit   INTEGER NOT NULL DEFAULT 0,
  reversal_of    INTEGER REFERENCES journal_entries(id),
  reversed_by    INTEGER REFERENCES journal_entries(id),
  voided_at      TEXT,
  voided_by      INTEGER REFERENCES users(id),
  is_demo        INTEGER NOT NULL DEFAULT 0,
  posted_by      INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (company_id, number),
  CHECK (total_debit >= 0 AND total_credit >= 0)
);
CREATE INDEX IF NOT EXISTS idx_entries_company ON journal_entries(company_id, date);
CREATE INDEX IF NOT EXISTS idx_entries_source ON journal_entries(company_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS journal_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id      INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL DEFAULT 1,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  description   TEXT,
  debit         INTEGER NOT NULL DEFAULT 0,
  credit        INTEGER NOT NULL DEFAULT 0,
  base_debit    INTEGER NOT NULL DEFAULT 0,
  base_credit   INTEGER NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'UZS',
  fx_rate_micro INTEGER NOT NULL DEFAULT 1000000,
  contact_type  TEXT,
  contact_id    INTEGER,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
  tax_code_id   INTEGER REFERENCES tax_codes(id),
  tax_amount    INTEGER NOT NULL DEFAULT 0,
  doc_type      TEXT,
  doc_id        INTEGER,
  CHECK (debit >= 0 AND credit >= 0),
  CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX IF NOT EXISTS idx_lines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_lines_account ON journal_lines(company_id, account_id);
CREATE INDEX IF NOT EXISTS idx_lines_contact ON journal_lines(company_id, contact_type, contact_id);
CREATE INDEX IF NOT EXISTS idx_lines_doc ON journal_lines(doc_type, doc_id);

/* ------------------------------------------------------------------ planning */
CREATE TABLE IF NOT EXISTS budgets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  period_type   TEXT NOT NULL DEFAULT 'month', -- month | quarter | year
  year          INTEGER NOT NULL,
  period_index  INTEGER NOT NULL DEFAULT 1,     -- 1-12 | 1-4 | 1
  scope         TEXT NOT NULL DEFAULT 'category', -- company | department | category | account
  department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  category_id   INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  account_id    INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  amount        INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budgets_company ON budgets(company_id, year);

CREATE TABLE IF NOT EXISTS tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description    TEXT,
  type           TEXT NOT NULL DEFAULT 'review',
  priority       TEXT NOT NULL DEFAULT 'medium',
  status         TEXT NOT NULL DEFAULT 'todo',
  due_date       TEXT,
  assignee_id    INTEGER REFERENCES users(id),
  related_type   TEXT,
  related_id     INTEGER,
  source         TEXT NOT NULL DEFAULT 'auto',
  auto_key       TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL,
  completed_at   TEXT,
  UNIQUE (company_id, auto_key)
);
CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id, status);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  severity    TEXT NOT NULL DEFAULT 'info', -- info | warning | critical | success
  link        TEXT,
  is_read     INTEGER NOT NULL DEFAULT 0,
  dedupe_key  TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (company_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_company ON notifications(company_id, created_at);

CREATE TABLE IF NOT EXISTS alerts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  severity       TEXT NOT NULL DEFAULT 'medium',
  title          TEXT NOT NULL,
  what_happened  TEXT NOT NULL,
  why_problem    TEXT NOT NULL,
  impact_amount  INTEGER NOT NULL DEFAULT 0,
  how_to_fix     TEXT NOT NULL,
  confidence_bp  INTEGER NOT NULL DEFAULT 8000,
  status         TEXT NOT NULL DEFAULT 'open', -- open | reviewing | resolved | ignored
  fingerprint    TEXT NOT NULL,
  related_type   TEXT,
  related_id     INTEGER,
  meta           TEXT,
  detected_at    TEXT NOT NULL,
  resolved_at    TEXT,
  resolved_by    INTEGER REFERENCES users(id),
  UNIQUE (company_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_alerts_company ON alerts(company_id, status);

CREATE TABLE IF NOT EXISTS month_closes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period       TEXT NOT NULL,   -- YYYY-MM
  status       TEXT NOT NULL DEFAULT 'open', -- open | in_progress | closed
  checks       TEXT NOT NULL DEFAULT '[]',
  blockers     INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  completed_by INTEGER REFERENCES users(id),
  reopened_at  TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (company_id, period)
);

CREATE TABLE IF NOT EXISTS tax_obligations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,     -- vat | profit | social | payroll | turnover | property | land | other
  name         TEXT NOT NULL,
  period       TEXT NOT NULL,     -- YYYY-MM or YYYY-Qn
  due_date     TEXT NOT NULL,
  amount       INTEGER NOT NULL DEFAULT 0,
  paid_amount  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'upcoming', -- upcoming | due | paid | overdue
  source_ref   TEXT,
  source_note  TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (company_id, kind, period)
);
CREATE INDEX IF NOT EXISTS idx_tax_obligations ON tax_obligations(company_id, due_date);

CREATE TABLE IF NOT EXISTS recurring_documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,     -- invoice | bill | expense
  template      TEXT NOT NULL,
  frequency     TEXT NOT NULL DEFAULT 'monthly',
  interval_days INTEGER NOT NULL DEFAULT 30,
  next_run_date TEXT NOT NULL,
  last_run_date TEXT,
  occurrences   INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL
);

/* ------------------------------------------------------------------ system */
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  user_name   TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  summary     TEXT,
  before      TEXT,
  after       TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_log(company_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT,
  UNIQUE (company_id, key)
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  currency     TEXT NOT NULL,
  rate_micro   INTEGER NOT NULL,   -- units of base currency per 1 unit of foreign currency * 1e6
  source       TEXT,
  UNIQUE (company_id, date, currency)
);

CREATE TABLE IF NOT EXISTS sequences (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  prefix        TEXT NOT NULL DEFAULT '',
  next_value    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, kind)
);

/* ------------------------------------------------------------ derived views */
DROP VIEW IF EXISTS v_account_balances;
CREATE VIEW v_account_balances AS
SELECT
  l.company_id                AS company_id,
  l.account_id                AS account_id,
  SUM(l.base_debit)           AS total_debit,
  SUM(l.base_credit)          AS total_credit,
  SUM(l.base_debit - l.base_credit) AS net
FROM journal_lines l
JOIN journal_entries e ON e.id = l.entry_id
WHERE e.status = 'posted'
GROUP BY l.company_id, l.account_id;

DROP VIEW IF EXISTS v_stock_balances;
CREATE VIEW v_stock_balances AS
SELECT
  m.company_id AS company_id,
  m.product_id AS product_id,
  m.warehouse_id AS warehouse_id,
  SUM(CASE WHEN m.direction IN ('in','transfer_in','adjust_in') THEN m.qty_milli ELSE -m.qty_milli END) AS qty_milli,
  SUM(CASE WHEN m.direction IN ('in','transfer_in','adjust_in') THEN m.value ELSE -m.value END) AS value
FROM stock_moves m
GROUP BY m.company_id, m.product_id, m.warehouse_id;
`;
