import { all, insert, nowISO, one, run, tx } from "@/lib/db";
import { ValidationError } from "@/lib/accounting/errors";
import { recordAudit } from "./company";

export type ContactKind = "customer" | "supplier" | "both";

export type ContactInput = {
  companyId: number;
  kind: ContactKind;
  name: string;
  legalName?: string;
  taxId?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  bankName?: string;
  bankAccount?: string;
  mfo?: string;
  currency?: string;
  paymentTermsDays?: number;
  creditLimit?: number;
  notes?: string;
  userId?: number | null;
  userName?: string | null;
};

export function createContact(input: ContactInput): number {
  if (!input.name?.trim()) throw new ValidationError("NAME_REQUIRED", "Company name is required");
  return tx(() => {
    const stamp = nowISO();
    const id = insert(
      `INSERT INTO contacts
        (company_id, kind, name, legal_name, tax_id, contact_person, phone, email, address, bank_name, bank_account,
         mfo, currency, payment_terms_days, credit_limit, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.companyId,
        input.kind,
        input.name.trim(),
        input.legalName ?? null,
        input.taxId ?? null,
        input.contactPerson ?? null,
        input.phone ?? null,
        input.email ?? null,
        input.address ?? null,
        input.bankName ?? null,
        input.bankAccount ?? null,
        input.mfo ?? null,
        input.currency ?? "UZS",
        input.paymentTermsDays ?? 14,
        Math.round(input.creditLimit ?? 0),
        input.notes ?? null,
        input.userId ?? null,
        stamp,
        stamp,
      ],
    );
    recordAudit({
      companyId: input.companyId,
      userId: input.userId,
      userName: input.userName,
      action: "create",
      entityType: "contact",
      entityId: id,
      summary: `Created ${input.kind} "${input.name}"`,
      after: { name: input.name, kind: input.kind, taxId: input.taxId ?? null },
    });
    return id;
  });
}

export function updateContact(companyId: number, contactId: number, patch: Partial<ContactInput> & { isArchived?: boolean }, ctx: { userId?: number | null; userName?: string | null } = {}): void {
  const existing = one<Record<string, unknown>>("SELECT * FROM contacts WHERE id = ? AND company_id = ?", [contactId, companyId]);
  if (!existing) throw new ValidationError("NOT_FOUND", "Contact not found");
  const map: [keyof ContactInput | "isArchived", string][] = [
    ["name", "name"],
    ["legalName", "legal_name"],
    ["taxId", "tax_id"],
    ["contactPerson", "contact_person"],
    ["phone", "phone"],
    ["email", "email"],
    ["address", "address"],
    ["bankName", "bank_name"],
    ["bankAccount", "bank_account"],
    ["mfo", "mfo"],
    ["currency", "currency"],
    ["paymentTermsDays", "payment_terms_days"],
    ["creditLimit", "credit_limit"],
    ["notes", "notes"],
    ["isArchived", "is_archived"],
  ];
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of map) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (patch.kind) {
    fields.push("kind = ?");
    values.push(patch.kind);
  }
  if (!fields.length) return;
  values.push(nowISO(), companyId, contactId);
  run(`UPDATE contacts SET ${fields.join(", ")}, updated_at = ? WHERE company_id = ? AND id = ?`, values);
  recordAudit({
    companyId,
    userId: ctx.userId,
    userName: ctx.userName,
    action: "update",
    entityType: "contact",
    entityId: contactId,
    summary: `Updated contact`,
    before: existing,
    after: patch,
  });
}

export type ContactSummary = {
  id: number;
  kind: ContactKind;
  name: string;
  legalName: string | null;
  taxId: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  bankName: string | null;
  bankAccount: string | null;
  mfo: string | null;
  currency: string;
  paymentTermsDays: number;
  creditLimit: number;
  notes: string | null;
  isArchived: boolean;
  createdAt: string;
  ledgerBalance: number;
  invoiced: number;
  paid: number;
  outstanding: number;
  overdue: number;
  lastActivity: string | null;
  documents: number;
};

/**
 * Contact financial summary.
 *
 * `ledgerBalance` comes from the ledger (accounts 1101 / 2011 filtered by
 * contact) — it is the authoritative figure. Document totals are shown next to
 * it and any difference is surfaced rather than hidden.
 */
export function contactSummary(companyId: number, contactId: number, asOf: string): ContactSummary | undefined {
  const contact = one<{
    id: number;
    kind: ContactKind;
    name: string;
    legal_name: string | null;
    tax_id: string | null;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    bank_name: string | null;
    bank_account: string | null;
    mfo: string | null;
    currency: string;
    payment_terms_days: number;
    credit_limit: number;
    notes: string | null;
    is_archived: number;
    created_at: string;
  }>("SELECT * FROM contacts WHERE id = ? AND company_id = ?", [contactId, companyId]);
  if (!contact) return undefined;

  const ledger = one<{ net: number }>(
    `SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND l.contact_id = ? AND e.status = 'posted' AND e.date <= ?
        AND a.subtype = 'receivable'`,
    [companyId, contactId, asOf],
  );

  const invoiceTotals = one<{ invoiced: number; paid: number; outstanding: number; overdue: number; docs: number }>(
    `SELECT COALESCE(SUM(total), 0) AS invoiced,
            COALESCE(SUM(amount_paid), 0) AS paid,
            COALESCE(SUM(CASE WHEN total > amount_paid THEN total - amount_paid ELSE 0 END), 0) AS outstanding,
            COALESCE(SUM(CASE WHEN total > amount_paid AND due_date < ? THEN total - amount_paid ELSE 0 END), 0) AS overdue,
            COUNT(*) AS docs
       FROM invoices WHERE company_id = ? AND contact_id = ? AND status NOT IN ('draft','cancelled')`,
    [asOf, companyId, contactId],
  );

  const billTotals = one<{ total: number; paid: number }>(
    `SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(amount_paid), 0) AS paid
       FROM bills WHERE company_id = ? AND contact_id = ? AND status <> 'cancelled'`,
    [companyId, contactId],
  );

  const expenseTotals = one<{ total: number }>(
    "SELECT COALESCE(SUM(amount + tax_amount), 0) AS total FROM expenses WHERE company_id = ? AND contact_id = ?",
    [companyId, contactId],
  );

  const lastActivity = one<{ date: string | null }>(
    `SELECT MAX(day) AS date FROM (
        SELECT MAX(date) AS day FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.company_id = ? AND l.contact_id = ? AND e.status = 'posted'
      )`,
    [companyId, contactId],
  );

  const isCustomer = contact.kind === "customer" || contact.kind === "both";
  const isSupplier = contact.kind === "supplier" || contact.kind === "both";
  const invoiced = isCustomer ? (invoiceTotals?.invoiced ?? 0) : (billTotals?.total ?? 0) + (expenseTotals?.total ?? 0);
  const paid = isCustomer ? (invoiceTotals?.paid ?? 0) : (billTotals?.paid ?? 0);

  return {
    id: contact.id,
    kind: contact.kind,
    name: contact.name,
    legalName: contact.legal_name,
    taxId: contact.tax_id,
    contactPerson: contact.contact_person,
    phone: contact.phone,
    email: contact.email,
    address: contact.address,
    bankName: contact.bank_name,
    bankAccount: contact.bank_account,
    mfo: contact.mfo,
    currency: contact.currency,
    paymentTermsDays: contact.payment_terms_days,
    creditLimit: contact.credit_limit,
    notes: contact.notes,
    isArchived: Boolean(contact.is_archived),
    createdAt: contact.created_at,
    ledgerBalance: isCustomer ? (ledger?.net ?? 0) : -Math.abs(ledger?.net ?? 0),
    invoiced,
    paid,
    outstanding: isCustomer ? (invoiceTotals?.outstanding ?? 0) : Math.max(0, invoiced - paid),
    overdue: isCustomer ? (invoiceTotals?.overdue ?? 0) : 0,
    lastActivity: lastActivity?.date ?? null,
    documents: (invoiceTotals?.docs ?? 0) + 0,
    ...(isSupplier ? {} : {}),
  };
}

export function listContacts(companyId: number, kind?: ContactKind | "all"): ContactSummary[] {
  const rows = all<{ id: number }>(
    `SELECT id FROM contacts WHERE company_id = ? AND is_archived = 0 ${
      kind && kind !== "all" ? "AND (kind = ? OR kind = 'both')" : ""
    } ORDER BY name`,
    kind && kind !== "all" ? [companyId, kind] : [companyId],
  );
  const asOf = new Date().toISOString().slice(0, 10);
  return rows.map((row) => contactSummary(companyId, row.id, asOf)).filter((row): row is ContactSummary => Boolean(row));
}
