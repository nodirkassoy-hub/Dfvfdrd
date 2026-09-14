/**
 * Company provisioning: creating a company always creates a complete, working
 * accounting environment — chart of accounts, tax codes, categories, warehouse,
 * cash account, sequences and default settings — inside one transaction, so a
 * new workspace can never be half-initialised.
 */
import { all, insert, nowISO, one, run, tx } from "@/lib/db";
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, DEFAULT_DEPARTMENTS, DEFAULT_TAX_CODES, SYSTEM_ACCOUNTS } from "@/lib/accounting/coa";
import { accountIdByCodeOrThrow } from "@/lib/accounting/engine";
import type { Locale } from "@/lib/i18n/types";
import type { Permission } from "@/lib/auth/permissions";

export type CreateCompanyInput = {
  name: string;
  legalName?: string;
  taxId?: string;
  vatNumber?: string;
  address?: string;
  directorName?: string;
  chiefAccountantName?: string;
  phone?: string;
  email?: string;
  industry?: string;
  baseCurrency?: string;
  taxRegime?: "vat" | "turnover" | "general";
  invoicePrefix?: string;
  locale?: Locale;
  isDemo?: boolean;
  userId?: number | null;
  role?: "owner" | "admin" | "accountant" | "manager" | "viewer";
};

export function createCompany(input: CreateCompanyInput): number {
  return tx(() => {
    const stamp = nowISO();
    const companyId = insert(
      `INSERT INTO companies
        (name, legal_name, tax_id, vat_number, address, director_name, chief_accountant_name, phone, email, industry,
         base_currency, tax_regime, invoice_prefix, is_demo, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.name,
        input.legalName ?? input.name,
        input.taxId ?? null,
        input.vatNumber ?? null,
        input.address ?? null,
        input.directorName ?? null,
        input.chiefAccountantName ?? null,
        input.phone ?? null,
        input.email ?? null,
        input.industry ?? null,
        input.baseCurrency ?? "UZS",
        input.taxRegime ?? "vat",
        input.invoicePrefix ?? "INV",
        input.isDemo ? 1 : 0,
        input.userId ?? null,
        stamp,
        stamp,
      ],
    );

    provisionChartOfAccounts(companyId, input.locale ?? "uz");
    provisionDefaultBankAccounts(companyId, input.locale ?? "uz");
    provisionDefaultWarehouse(companyId);
    provisionSequences(companyId, input.invoicePrefix ?? "INV");
    provisionSettings(companyId);

    if (input.userId) {
      insert(
        `INSERT INTO company_members (company_id, user_id, name, role, permissions, status, accepted_at, last_active_at)
         VALUES (?, ?, ?, ?, '[]', 'active', ?, ?)`,
        [companyId, input.userId, input.directorName ?? null, input.role ?? "owner", stamp, stamp],
      );
    }

    return companyId;
  });
}

export function provisionChartOfAccounts(companyId: number, locale: Locale = "uz"): void {
  const stamp = nowISO();
  const idByCode = new Map<string, number>();

  for (const account of DEFAULT_ACCOUNTS) {
    const localized = locale === "ru" ? account.nameRu : locale === "uz" ? account.nameUz : account.name;
    const parentId = account.parent ? (idByCode.get(account.parent) ?? null) : null;
    const accountId = insert(
      `INSERT INTO accounts (company_id, code, name, type, subtype, parent_id, is_postable, currency, is_system, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        account.code,
        localized,
        account.type,
        account.subtype ?? null,
        parentId,
        account.postable === false ? 0 : 1,
        "UZS",
        account.system ? 1 : 0,
        stamp,
      ],
    );
    idByCode.set(account.code, accountId);
  }

  for (const taxCode of DEFAULT_TAX_CODES) {
    insert(
      `INSERT INTO tax_codes (company_id, code, name, kind, rate_bp, account_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        companyId,
        taxCode.code,
        taxCode.name,
        taxCode.kind,
        taxCode.rateBp,
        taxCode.account ? (idByCode.get(taxCode.account) ?? null) : null,
      ],
    );
  }

  for (const category of DEFAULT_CATEGORIES) {
    const localized = locale === "ru" ? category.nameRu : locale === "uz" ? category.nameUz : category.name;
    insert("INSERT INTO categories (company_id, name, kind, account_id, created_at) VALUES (?, ?, ?, ?, ?)", [
      companyId,
      localized,
      category.kind,
      idByCode.get(category.account) ?? null,
      stamp,
    ]);
  }

  for (const department of DEFAULT_DEPARTMENTS) {
    const localized = locale === "ru" ? department.nameRu : locale === "uz" ? department.nameUz : department.name;
    insert("INSERT INTO departments (company_id, name, created_at) VALUES (?, ?, ?)", [companyId, localized, stamp]);
  }
}

export function provisionDefaultBankAccounts(companyId: number, locale: Locale = "uz"): void {
  /* Names come from the ledger accounts themselves, so a bank account can never
     disagree with the account it posts to. */
  const bankLedger = one<{ name: string }>("SELECT name FROM accounts WHERE company_id = ? AND code = ?", [companyId, "1021"]);
  const cashLedger = one<{ name: string }>("SELECT name FROM accounts WHERE company_id = ? AND code = ?", [companyId, "1010"]);
  const bankLabel = { en: "Bank", uz: "Bank", ru: "Банк" }[locale];
  const cashLabel = { en: "Cash register", uz: "Kassa", ru: "Касса" }[locale];

  createBankAccount({
    companyId,
    name: bankLedger?.name ?? "Main bank account (UZS)",
    kind: "bank",
    bankName: bankLabel,
    currency: "UZS",
    isDefault: true,
    accountCode: "1021",
  });

  createBankAccount({
    companyId,
    name: cashLedger?.name ?? cashLabel,
    kind: "cash",
    currency: "UZS",
    accountCode: "1010",
  });
}

export function provisionDefaultWarehouse(companyId: number): void {
  insert("INSERT INTO warehouses (company_id, name, code, is_default, created_at) VALUES (?, ?, ?, 1, ?)", [
    companyId,
    "Main warehouse",
    "MAIN",
    nowISO(),
  ]);
}

function provisionSequences(companyId: number, invoicePrefix: string): void {
  const stamp = nowISO();
  const kinds: [string, string][] = [
    ["invoice", invoicePrefix],
    ["bill", "BILL"],
    ["expense", "EXP"],
    ["payment", "PAY"],
    ["quote", "QT"],
  ];
  for (const [kind, prefix] of kinds) {
    insert("INSERT INTO sequences (company_id, kind, prefix, next_value) VALUES (?, ?, ?, 1)", [companyId, kind, prefix]);
    void stamp;
  }
}

function provisionSettings(companyId: number): void {
  const defaults: Record<string, unknown> = {
    "notifications.invoiceOverdueDays": 1,
    "notifications.lowStockAlerts": true,
    "close.requireZeroBlockers": true,
    "reports.defaultGrouping": "monthly",
  };
  for (const [key, value] of Object.entries(defaults)) {
    insert("INSERT INTO settings (company_id, key, value) VALUES (?, ?, ?)", [companyId, key, JSON.stringify(value)]);
  }
}

export type BankAccountInput = {
  companyId: number;
  name: string;
  kind?: "bank" | "cash";
  bankName?: string;
  accountNumber?: string;
  mfo?: string;
  currency?: string;
  isDefault?: boolean;
  accountCode?: string;
};

export function createBankAccount(input: BankAccountInput): number {
  return tx(() => {
    const stamp = nowISO();
    const currency = input.currency ?? "UZS";
    let ledgerAccountId: number;

    if (input.accountCode) {
      ledgerAccountId = accountIdByCodeOrThrow(input.companyId, input.accountCode);
    } else {
      const prefix = input.kind === "cash" ? "101" : "102";
      const existing = all<{ code: string }>(
        "SELECT code FROM accounts WHERE company_id = ? AND code LIKE ? ORDER BY code DESC LIMIT 1",
        [input.companyId, `${prefix}%`],
      );
      const nextNumber = existing.length ? Number(existing[0].code) + 1 : Number(`${prefix}1`);
      const parentCode = prefix === "102" ? "1020" : "1010";
      const parent = one<{ id: number }>("SELECT id FROM accounts WHERE company_id = ? AND code = ?", [
        input.companyId,
        parentCode,
      ]);
      ledgerAccountId = insert(
        `INSERT INTO accounts (company_id, code, name, type, subtype, parent_id, is_postable, currency, created_at)
         VALUES (?, ?, ?, 'asset', ?, ?, 1, ?, ?)`,
        [
          input.companyId,
          String(nextNumber),
          input.kind === "cash" ? `Cash register — ${input.name}` : `Bank — ${input.name}`,
          input.kind === "cash" ? "cash" : "bank",
          parent?.id ?? null,
          currency,
          stamp,
        ],
      );
    }

    if (input.isDefault) {
      run("UPDATE bank_accounts SET is_default = 0 WHERE company_id = ?", [input.companyId]);
    }

    return insert(
      `INSERT INTO bank_accounts
        (company_id, name, kind, bank_name, account_number, mfo, currency, account_id, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.companyId,
        input.name,
        input.kind ?? "bank",
        input.bankName ?? null,
        input.accountNumber ?? null,
        input.mfo ?? null,
        currency,
        ledgerAccountId,
        input.isDefault ? 1 : 0,
        stamp,
      ],
    );
  });
}

/* ------------------------------------------------------------------- audit */
export type AuditInput = {
  companyId: number;
  userId?: number | null;
  userName?: string | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

export function recordAudit(input: AuditInput): void {
  insert(
    `INSERT INTO audit_log (company_id, user_id, user_name, action, entity_type, entity_id, summary, before, after, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.companyId,
      input.userId ?? null,
      input.userName ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.summary ?? null,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      input.ip ?? null,
      nowISO(),
    ],
  );
}

/* ---------------------------------------------------------------- settings */
export function getSetting<T>(companyId: number, key: string, fallback: T): T {
  const row = one<{ value: string }>("SELECT value FROM settings WHERE company_id = ? AND key = ?", [companyId, key]);
  if (!row?.value) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(companyId: number, key: string, value: unknown): void {
  const existing = one<{ id: number }>("SELECT id FROM settings WHERE company_id = ? AND key = ?", [companyId, key]);
  if (existing) run("UPDATE settings SET value = ? WHERE id = ?", [JSON.stringify(value), existing.id]);
  else insert("INSERT INTO settings (company_id, key, value) VALUES (?, ?, ?)", [companyId, key, JSON.stringify(value)]);
}

export type CompanyRecord = {
  id: number;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  vat_number: string | null;
  address: string | null;
  director_name: string | null;
  chief_accountant_name: string | null;
  phone: string | null;
  email: string | null;
  industry: string | null;
  base_currency: string;
  tax_regime: string;
  vat_rate_bp: number;
  turnover_rate_bp: number;
  profit_tax_rate_bp: number;
  social_rate_bp: number;
  payroll_income_bp: number;
  invoice_prefix: string;
  brand_color: string;
  is_demo: number;
  status: string;
  locked_through: string | null;
  fiscal_year_start_month: number;
  created_at: string;
};

export function getCompany(companyId: number): CompanyRecord | undefined {
  return one<CompanyRecord>("SELECT * FROM companies WHERE id = ?", [companyId]);
}

export function updateCompany(companyId: number, patch: Partial<CompanyRecord>): void {
  const allowed: (keyof CompanyRecord)[] = [
    "name",
    "legal_name",
    "tax_id",
    "vat_number",
    "address",
    "director_name",
    "chief_accountant_name",
    "phone",
    "email",
    "industry",
    "base_currency",
    "tax_regime",
    "vat_rate_bp",
    "turnover_rate_bp",
    "profit_tax_rate_bp",
    "social_rate_bp",
    "payroll_income_bp",
    "invoice_prefix",
    "brand_color",
    "fiscal_year_start_month",
  ];
  const fields = allowed.filter((field) => patch[field] !== undefined);
  if (!fields.length) return;
  const sql = `UPDATE companies SET ${fields.map((f) => `${f} = ?`).join(", ")}, updated_at = ? WHERE id = ?`;
  run(sql, [...fields.map((field) => patch[field] as never), nowISO(), companyId]);
}

export function setLockedThrough(companyId: number, date: string | null): void {
  run("UPDATE companies SET locked_through = ?, updated_at = ? WHERE id = ?", [date, nowISO(), companyId]);
}

/* ------------------------------------------------------------------ members */
export type MemberRow = {
  id: number;
  userId: number | null;
  name: string | null;
  email: string | null;
  role: string;
  permissions: string;
  status: string;
  invitedAt: string | null;
  acceptedAt: string | null;
  lastActiveAt: string | null;
};

export function listMembers(companyId: number): MemberRow[] {
  return all<MemberRow>(
    `SELECT m.id, m.user_id AS userId, COALESCE(m.name, u.name) AS name, COALESCE(u.email, m.invited_email) AS email,
            m.role, m.permissions, m.status, m.invited_at AS invitedAt, m.accepted_at AS acceptedAt,
            m.last_active_at AS lastActiveAt
       FROM company_members m
       LEFT JOIN users u ON u.id = m.user_id
      WHERE m.company_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'accountant' THEN 2 WHEN 'manager' THEN 3 ELSE 4 END, name`,
    [companyId],
  );
}

export function updateMember(companyId: number, memberId: number, patch: { role?: string; permissions?: Permission[]; status?: string }): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.role) {
    fields.push("role = ?");
    values.push(patch.role);
  }
  if (patch.permissions) {
    fields.push("permissions = ?");
    values.push(JSON.stringify(patch.permissions));
  }
  if (patch.status) {
    fields.push("status = ?");
    values.push(patch.status);
  }
  if (!fields.length) return;
  values.push(companyId, memberId);
  run(`UPDATE company_members SET ${fields.join(", ")} WHERE company_id = ? AND id = ?`, values);
}

export function inviteMember(companyId: number, email: string, name: string, role: string, permissions: Permission[]): number {
  const stamp = nowISO();
  const existingUser = one<{ id: number }>("SELECT id FROM users WHERE email = ?", [email.toLowerCase()]);
  return insert(
    `INSERT INTO company_members (company_id, user_id, invited_email, name, role, permissions, status, invited_at)
     VALUES (?, ?, ?, ?, ?, ?, 'invited', ?)`,
    [companyId, existingUser?.id ?? null, email.toLowerCase(), name, role, JSON.stringify(permissions), stamp],
  );
}

export function listAuditLog(companyId: number, limit = 100, entityType?: string): Record<string, unknown>[] {
  return all(
    `SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.summary,
            COALESCE(a.user_name, u.name, 'System') AS userName, a.before, a.after, a.created_at AS createdAt
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.company_id = ? ${entityType ? "AND a.entity_type = ?" : ""}
      ORDER BY a.id DESC LIMIT ?`,
    entityType ? [companyId, entityType, limit] : [companyId, limit],
  );
}

export const DEFAULT_CASH_LEDGER_ACCOUNT = SYSTEM_ACCOUNTS.CASH;
