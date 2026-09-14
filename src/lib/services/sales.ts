/**
 * Sales cycle: invoice → journal entry → receivable → payment.
 *
 * Posting rules (all validated by the accounting engine, so an unbalanced
 * combination can never be written):
 *
 *   Invoice sent      Dr Trade receivables (1101)        total
 *                     Cr Revenue (4xxx per line)         net (per line)
 *                     Cr VAT payable (2031)              tax (per line)
 *
 *   Goods issued      Dr Cost of goods sold (5010)       weighted cost
 *                     Cr Inventory (1201)                weighted cost
 *
 *   Payment received  Dr Bank/cash account               amount
 *                     Cr Trade receivables (1101)        amount
 */
import { all, insert, nowISO, one, run, tx } from "@/lib/db";
import { AccountingError, ValidationError } from "@/lib/accounting/errors";
import { SYSTEM_ACCOUNTS } from "@/lib/accounting/coa";
import { accountIdByCodeOrThrow, nextDocumentNumber, postEntryTx, voidEntry } from "@/lib/accounting/engine";
import { computeDocument, documentStatusFromPayments, type LineInput } from "./line-math";
import { recordAudit } from "./company";
import { consumeStockForDocument } from "./inventory";

export type Ctx = { userId?: number | null; userName?: string | null; ip?: string | null };

export type InvoiceInput = {
  companyId: number;
  contactId: number;
  issueDate: string;
  dueDate: string;
  currency?: string;
  fxRateMicro?: number;
  lines: LineInput[];
  notes?: string;
  terms?: string;
  warehouseId?: number | null;
  recurring?: { frequency: "weekly" | "monthly" | "quarterly" | "yearly"; nextRun: string } | null;
  number?: string;
};

function assertDateOrder(issue: string, due: string) {
  if (due < issue) throw new ValidationError("DATE_ORDER", "Due date cannot be before the issue date");
}

export function createInvoice(input: InvoiceInput, ctx: Ctx = {}): number {
  if (!input.lines?.length) throw new ValidationError("NO_LINES", "An invoice needs at least one line");
  assertDateOrder(input.issueDate, input.dueDate);
  const contact = one<{ id: number; payment_terms_days: number }>(
    "SELECT id, payment_terms_days FROM contacts WHERE id = ? AND company_id = ?",
    [input.contactId, input.companyId],
  );
  if (!contact) throw new ValidationError("CONTACT_NOT_FOUND", "Customer not found");

  return tx(() => {
    const stamp = nowISO();
    const currency = input.currency ?? "UZS";
    const fxRateMicro = input.fxRateMicro ?? 1_000_000;
    const number = input.number ?? nextDocumentNumber(input.companyId, "invoice", invoicePrefix(input.companyId));
    const computed = computeDocument(input.lines, currency);

    const invoiceId = insert(
      `INSERT INTO invoices
        (company_id, number, contact_id, issue_date, due_date, currency, fx_rate_micro, status, subtotal, discount_total,
         tax_total, total, amount_paid, notes, terms, warehouse_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      [
        input.companyId,
        number,
        input.contactId,
        input.issueDate,
        input.dueDate,
        currency,
        fxRateMicro,
        computed.subtotal,
        computed.discountTotal,
        computed.taxTotal,
        computed.total,
        input.notes ?? null,
        input.terms ?? null,
        input.warehouseId ?? null,
        ctx.userId ?? null,
        stamp,
        stamp,
      ],
    );

    insertInvoiceLines(invoiceId, computed.lines, input.companyId, currency);
    recordAudit({
      companyId: input.companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "create",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Created invoice ${number}`,
      after: { number, total: computed.total, currency },
      ip: ctx.ip,
    });
    return invoiceId;
  });
}

function invoicePrefix(companyId: number): string {
  const company = one<{ invoice_prefix: string }>("SELECT invoice_prefix FROM companies WHERE id = ?", [companyId]);
  return company?.invoice_prefix ?? "INV";
}

function insertInvoiceLines(
  invoiceId: number,
  lines: ReturnType<typeof computeDocument>["lines"],
  companyId: number,
  currency: string,
): void {
  const defaultRevenue = accountIdByCodeOrThrow(companyId, SYSTEM_ACCOUNTS.SALES_GOODS);
  lines.forEach((line, index) => {
    insert(
      `INSERT INTO invoice_lines
        (invoice_id, line_no, product_id, description, qty_milli, unit_price, discount, tax_code_id, tax_rate_bp,
         tax_amount, net_amount, line_total, account_id, warehouse_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId,
        index + 1,
        line.productId ?? null,
        line.description,
        line.qtyMilli,
        line.unitPrice,
        line.discount ?? 0,
        line.taxCodeId ?? null,
        line.taxRateBp ?? 0,
        line.taxAmount,
        line.netAmount,
        line.lineTotal,
        line.accountId ?? defaultRevenue,
        line.warehouseId ?? null,
      ],
    );
  });
  void currency;
}

export function updateInvoice(companyId: number, invoiceId: number, input: InvoiceInput, ctx: Ctx = {}): void {
  return tx(() => {
    const invoice = one<{ status: string; amount_paid: number; number: string }>(
      "SELECT status, amount_paid, number FROM invoices WHERE id = ? AND company_id = ?",
      [invoiceId, companyId],
    );
    if (!invoice) throw new ValidationError("NOT_FOUND", "Invoice not found");
    if (invoice.amount_paid > 0) throw new ValidationError("HAS_PAYMENTS", "Invoice with recorded payments cannot be edited. Void it and issue a new one.");
    if (invoice.status === "cancelled") throw new ValidationError("CANCELLED", "Cancelled invoices cannot be edited");

    assertDateOrder(input.issueDate, input.dueDate);
    const currency = input.currency ?? "UZS";
    const computed = computeDocument(input.lines, currency);

    run(
      `UPDATE invoices SET contact_id = ?, issue_date = ?, due_date = ?, currency = ?, fx_rate_micro = ?, subtotal = ?,
        discount_total = ?, tax_total = ?, total = ?, notes = ?, terms = ?, warehouse_id = ?, updated_at = ?
        WHERE id = ? AND company_id = ?`,
      [
        input.contactId,
        input.issueDate,
        input.dueDate,
        currency,
        input.fxRateMicro ?? 1_000_000,
        computed.subtotal,
        computed.discountTotal,
        computed.taxTotal,
        computed.total,
        input.notes ?? null,
        input.terms ?? null,
        input.warehouseId ?? null,
        nowISO(),
        invoiceId,
        companyId,
      ],
    );
    run("DELETE FROM invoice_lines WHERE invoice_id = ?", [invoiceId]);
    insertInvoiceLines(invoiceId, computed.lines, companyId, currency);
    recalculateInvoiceStatus(invoiceId);
    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "update",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Updated invoice ${invoice.number}`,
      after: { total: computed.total },
      ip: ctx.ip,
    });
  });
}

/** Post the invoice to the ledger (accounts receivable increases). */
export function sendInvoice(companyId: number, invoiceId: number, ctx: Ctx = {}): { entryId: number } {
  return tx(() => {
    const invoice = one<{
      id: number;
      number: string;
      contact_id: number;
      issue_date: string;
      due_date: string;
      currency: string;
      fx_rate_micro: number;
      status: string;
      subtotal: number;
      tax_total: number;
      total: number;
      journal_entry_id: number | null;
      warehouse_id: number | null;
    }>("SELECT * FROM invoices WHERE id = ? AND company_id = ?", [invoiceId, companyId]);
    if (!invoice) throw new ValidationError("NOT_FOUND", "Invoice not found");
    if (invoice.journal_entry_id) throw new ValidationError("ALREADY_POSTED", "This invoice is already posted");
    if (invoice.status === "cancelled") throw new ValidationError("CANCELLED", "Cancelled invoices cannot be sent");
    if (invoice.total <= 0) throw new ValidationError("ZERO_TOTAL", "Invoice total must be greater than zero");

    const lines = all<{
      id: number;
      account_id: number | null;
      product_id: number | null;
      description: string;
      net_amount: number;
      tax_amount: number;
      tax_code_id: number | null;
      warehouse_id: number | null;
    }>("SELECT id, account_id, product_id, description, net_amount, tax_amount, tax_code_id, warehouse_id FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no", [
      invoiceId,
    ]);

    const arAccount = accountIdByCodeOrThrow(companyId, SYSTEM_ACCOUNTS.AR_TRADE);
    const vatAccount = accountIdByCodeOrThrow(companyId, SYSTEM_ACCOUNTS.VAT_PAYABLE);
    const defaultRevenue = accountIdByCodeOrThrow(companyId, SYSTEM_ACCOUNTS.SALES_GOODS);

    const revenueLines = lines.map((line) => ({
      accountId: line.account_id ?? defaultRevenue,
      credit: line.net_amount,
      description: line.description,
      currency: invoice.currency,
      fxRateMicro: invoice.fx_rate_micro,
      contactType: "customer" as const,
      contactId: invoice.contact_id,
      productId: line.product_id,
      taxCodeId: line.tax_code_id,
      taxAmount: line.tax_amount,
      docType: "invoice",
      docId: invoiceId,
    }));

    const entry = postEntryTx({
      companyId,
      date: invoice.issue_date,
      memo: `Invoice ${invoice.number}`,
      reference: invoice.number,
      sourceType: "invoice",
      sourceId: invoiceId,
      currency: invoice.currency,
      fxRateMicro: invoice.fx_rate_micro,
      userId: ctx.userId ?? null,
      lines: [
        {
          accountId: arAccount,
          debit: invoice.total,
          description: `Invoice ${invoice.number}`,
          currency: invoice.currency,
          fxRateMicro: invoice.fx_rate_micro,
          contactType: "customer",
          contactId: invoice.contact_id,
          docType: "invoice",
          docId: invoiceId,
        },
        ...revenueLines,
        ...(invoice.tax_total > 0
          ? [
              {
                accountId: vatAccount,
                credit: invoice.tax_total,
                description: `VAT on invoice ${invoice.number}`,
                currency: invoice.currency,
                fxRateMicro: invoice.fx_rate_micro,
                taxAmount: invoice.tax_total,
                docType: "invoice" as const,
                docId: invoiceId,
              },
            ]
          : []),
      ],
    });

    run("UPDATE invoices SET journal_entry_id = ?, status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?", [
      entry.id,
      nowISO(),
      nowISO(),
      invoiceId,
    ]);

    // Inventory: issuing goods to a customer reduces stock and books COGS.
    const stockLines = lines
      .filter((line) => line.product_id)
      .map((line) => ({
        productId: line.product_id as number,
        qtyMilli: 0,
      }));
    if (stockLines.length) {
      consumeStockForDocument({
        companyId,
        documentType: "invoice",
        documentId: invoiceId,
        date: invoice.issue_date,
        warehouseId: invoice.warehouse_id,
        currency: invoice.currency,
        fxRateMicro: invoice.fx_rate_micro,
        ctx,
      });
    }

    recalculateInvoiceStatus(invoiceId);
    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "post",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Posted invoice ${invoice.number} to the ledger (entry ${entry.number})`,
      after: { entryId: entry.id, total: invoice.total },
      ip: ctx.ip,
    });
    return { entryId: entry.id };
  });
}

export function recalculateInvoiceStatus(invoiceId: number): string {
  const invoice = one<{ total: number; amount_paid: number; due_date: string; status: string; journal_entry_id: number | null }>(
    "SELECT total, amount_paid, due_date, status, journal_entry_id FROM invoices WHERE id = ?",
    [invoiceId],
  );
  if (!invoice) return "unknown";
  if (invoice.status === "cancelled") return "cancelled";
  const today = new Date().toISOString().slice(0, 10);
  const next = documentStatusFromPayments(invoice.total, invoice.amount_paid, invoice.due_date, today, Boolean(invoice.journal_entry_id));
  if (next !== invoice.status) {
    run("UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?", [next, nowISO(), invoiceId]);
  }
  return next;
}

export type InvoicePaymentInput = {
  companyId: number;
  invoiceId: number;
  amount: number;
  date: string;
  bankAccountId: number;
  method?: string;
  reference?: string;
  notes?: string;
};

/**
 * Record a (possibly partial) payment against an invoice. Accounts receivable
 * decreases by exactly the amount received, and the ledger entry is created in
 * the same transaction as the payment record.
 */
export function recordInvoicePayment(input: InvoicePaymentInput, ctx: Ctx = {}): { paymentId: number; entryId: number } {
  if (input.amount <= 0) throw new ValidationError("AMOUNT_ZERO", "Payment amount must be greater than zero");
  return tx(() => {
    const invoice = one<{
      id: number;
      number: string;
      contact_id: number;
      currency: string;
      total: number;
      amount_paid: number;
      status: string;
      journal_entry_id: number | null;
    }>("SELECT * FROM invoices WHERE id = ? AND company_id = ?", [input.invoiceId, input.companyId]);
    if (!invoice) throw new ValidationError("NOT_FOUND", "Invoice not found");
    if (invoice.status === "cancelled") throw new ValidationError("CANCELLED", "Cannot pay a cancelled invoice");
    if (invoice.status === "draft") throw new ValidationError("NOT_SENT", "Send the invoice before recording a payment");
    if (input.amount > invoice.total - invoice.amount_paid) {
      throw new ValidationError("OVERPAYMENT", "Payment exceeds the outstanding amount on this invoice");
    }

    const bankAccount = one<{ id: number; account_id: number; currency: string; name: string }>(
      "SELECT id, account_id, currency, name FROM bank_accounts WHERE id = ? AND company_id = ?",
      [input.bankAccountId, input.companyId],
    );
    if (!bankAccount) throw new ValidationError("ACCOUNT_NOT_FOUND", "Receiving account not found");

    const number = nextDocumentNumber(input.companyId, "payment", "PAY");
    const entry = postEntryTx({
      companyId: input.companyId,
      date: input.date,
      memo: `Payment received for invoice ${invoice.number}`,
      reference: input.reference ?? invoice.number,
      sourceType: "payment",
      currency: invoice.currency,
      userId: ctx.userId ?? null,
      lines: [
        {
          accountId: bankAccount.account_id,
          debit: input.amount,
          description: `Payment for invoice ${invoice.number}`,
          currency: invoice.currency,
          contactType: "customer",
          contactId: invoice.contact_id,
          docType: "invoice",
          docId: invoice.id,
        },
        {
          accountId: accountIdByCodeOrThrow(input.companyId, SYSTEM_ACCOUNTS.AR_TRADE),
          credit: input.amount,
          description: `Settled invoice ${invoice.number}`,
          currency: invoice.currency,
          contactType: "customer",
          contactId: invoice.contact_id,
          docType: "invoice",
          docId: invoice.id,
        },
      ],
    });

    const paymentId = insert(
      `INSERT INTO payments
        (company_id, number, kind, contact_id, date, amount, currency, method, account_id, invoice_id, reference, notes,
         journal_entry_id, created_by, created_at)
       VALUES (?, ?, 'incoming', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.companyId,
        number,
        invoice.contact_id,
        input.date,
        input.amount,
        invoice.currency,
        input.method ?? "bank_transfer",
        bankAccount.id,
        invoice.id,
        input.reference ?? null,
        input.notes ?? null,
        entry.id,
        ctx.userId ?? null,
        nowISO(),
      ],
    );

    run("UPDATE invoices SET amount_paid = amount_paid + ?, updated_at = ? WHERE id = ?", [input.amount, nowISO(), invoice.id]);
    const status = recalculateInvoiceStatus(invoice.id);

    recordAudit({
      companyId: input.companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "payment",
      entityType: "invoice",
      entityId: invoice.id,
      summary: `Recorded payment ${number} of ${input.amount} minor units (invoice ${invoice.number} → ${status})`,
      before: { amountPaid: invoice.amount_paid, status: invoice.status },
      after: { amountPaid: invoice.amount_paid + input.amount, status, entryId: entry.id },
      ip: ctx.ip,
    });

    return { paymentId, entryId: entry.id };
  });
}

export function cancelInvoice(companyId: number, invoiceId: number, ctx: Ctx = {}, reason?: string): void {
  return tx(() => {
    const invoice = one<{ number: string; journal_entry_id: number | null; amount_paid: number; status: string }>(
      "SELECT number, journal_entry_id, amount_paid, status FROM invoices WHERE id = ? AND company_id = ?",
      [invoiceId, companyId],
    );
    if (!invoice) throw new ValidationError("NOT_FOUND", "Invoice not found");
    if (invoice.amount_paid > 0) throw new ValidationError("HAS_PAYMENTS", "Reverse the recorded payments before cancelling this invoice");
    if (invoice.journal_entry_id) {
      voidEntry(invoice.journal_entry_id, ctx.userId ?? null, reason ?? `Invoice ${invoice.number} cancelled`);
    }
    run("UPDATE invoices SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?", [nowISO(), nowISO(), invoiceId]);
    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "cancel",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Cancelled invoice ${invoice.number}`,
      before: { status: invoice.status },
      after: { status: "cancelled" },
      ip: ctx.ip,
    });
  });
}

export function duplicateInvoice(companyId: number, invoiceId: number, ctx: Ctx = {}): number {
  return tx(() => {
    const invoice = one<Record<string, unknown>>("SELECT * FROM invoices WHERE id = ? AND company_id = ?", [invoiceId, companyId]);
    if (!invoice) throw new ValidationError("NOT_FOUND", "Invoice not found");
    const lines = all<{
      product_id: number | null;
      description: string;
      qty_milli: number;
      unit_price: number;
      discount: number;
      tax_rate_bp: number;
      account_id: number | null;
      tax_code_id: number | null;
      warehouse_id: number | null;
    }>(
      "SELECT product_id, description, qty_milli, unit_price, discount, tax_rate_bp, account_id, tax_code_id, warehouse_id FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no",
      [invoiceId],
    );
    return createInvoice(
      {
        companyId,
        contactId: Number(invoice.contact_id),
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
        currency: String(invoice.currency),
        lines: lines.map((line) => ({
          productId: line.product_id,
          description: line.description,
          qtyMilli: line.qty_milli,
          unitPrice: line.unit_price,
          discount: line.discount,
          taxRateBp: line.tax_rate_bp,
          accountId: line.account_id,
          taxCodeId: line.tax_code_id,
          warehouseId: line.warehouse_id,
        })),
        notes: (invoice.notes as string) ?? undefined,
        terms: (invoice.terms as string) ?? undefined,
        warehouseId: (invoice.warehouse_id as number) ?? null,
      },
      ctx,
    );
  });
}

/** Refresh overdue flags; called on every sales page load so statuses are never stale. */
export function refreshOverdueInvoices(companyId: number, asOf: string): void {
  run(
    `UPDATE invoices SET status = 'overdue', updated_at = ?
      WHERE company_id = ? AND status IN ('sent','partially_paid') AND due_date < ?`,
    [nowISO(), companyId, asOf],
  );
}

export function deleteDraftInvoice(companyId: number, invoiceId: number, ctx: Ctx = {}): void {
  return tx(() => {
    const invoice = one<{ status: string; journal_entry_id: number | null; number: string }>(
      "SELECT status, journal_entry_id, number FROM invoices WHERE id = ? AND company_id = ?",
      [invoiceId, companyId],
    );
    if (!invoice) throw new ValidationError("NOT_FOUND", "Invoice not found");
    if (invoice.journal_entry_id) {
      throw new AccountingError("ENTRY_ALREADY_VOID", "Posted invoices cannot be deleted — cancel it instead so the ledger stays complete.");
    }
    run("DELETE FROM invoices WHERE id = ? AND company_id = ?", [invoiceId, companyId]);
    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "delete",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Deleted draft invoice ${invoice.number}`,
      ip: ctx.ip,
    });
  });
}

export type InvoiceRow = {
  id: number;
  number: string;
  status: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  total: number;
  amountPaid: number;
  amountDue: number;
  customerId: number;
  customerName: string;
  journalEntryId: number | null;
  daysOverdue: number;
  itemCount: number;
};

export function listInvoices(
  companyId: number,
  filters: { status?: string; contactId?: number; from?: string; to?: string; search?: string; limit?: number } = {},
): InvoiceRow[] {
  const conditions = ["i.company_id = ?"];
  const params: unknown[] = [companyId];
  if (filters.status && filters.status !== "all") {
    conditions.push("i.status = ?");
    params.push(filters.status);
  }
  if (filters.contactId) {
    conditions.push("i.contact_id = ?");
    params.push(filters.contactId);
  }
  if (filters.from) {
    conditions.push("i.issue_date >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push("i.issue_date <= ?");
    params.push(filters.to);
  }
  if (filters.search) {
    conditions.push("(i.number LIKE ? OR c.name LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  params.push(filters.limit ?? 200);

  const today = new Date().toISOString().slice(0, 10);
  return all<InvoiceRow>(
    `SELECT i.id, i.number, i.status, i.issue_date AS issueDate, i.due_date AS dueDate, i.currency,
            i.total, i.amount_paid AS amountPaid, i.total - i.amount_paid AS amountDue,
            i.contact_id AS customerId, c.name AS customerName, i.journal_entry_id AS journalEntryId,
            CASE WHEN i.due_date < ? AND i.total > i.amount_paid THEN
              CAST(julianday(?) - julianday(i.due_date) AS INTEGER) ELSE 0 END AS daysOverdue,
            (SELECT COUNT(*) FROM invoice_lines il WHERE il.invoice_id = i.id) AS itemCount
       FROM invoices i JOIN contacts c ON c.id = i.contact_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY i.issue_date DESC, i.id DESC
      LIMIT ?`,
    [today, today, ...params],
  );
}

export function getInvoiceDetail(companyId: number, invoiceId: number) {
  const invoice = one<Record<string, unknown>>(
    `SELECT i.*, c.name AS customerName, c.tax_id AS customerTaxId, c.address AS customerAddress, c.email AS customerEmail,
            c.phone AS customerPhone, c.legal_name AS customerLegalName, c.payment_terms_days AS customerTerms,
            e.number AS entryNumber, e.date AS entryDate, e.id AS entryId
       FROM invoices i
       JOIN contacts c ON c.id = i.contact_id
       LEFT JOIN journal_entries e ON e.id = i.journal_entry_id
      WHERE i.id = ? AND i.company_id = ?`,
    [invoiceId, companyId],
  );
  if (!invoice) return undefined;
  const lines = all(
    `SELECT il.*, p.name AS productName, p.sku, a.code AS accountCode, a.name AS accountName
       FROM invoice_lines il
       LEFT JOIN products p ON p.id = il.product_id
       LEFT JOIN accounts a ON a.id = il.account_id
      WHERE il.invoice_id = ? ORDER BY il.line_no`,
    [invoiceId],
  );
  const payments = all(
    `SELECT p.id, p.number, p.date, p.amount, p.method, p.reference, p.journal_entry_id AS journalEntryId,
            e.number AS entryNumber
       FROM payments p LEFT JOIN journal_entries e ON e.id = p.journal_entry_id
      WHERE p.invoice_id = ? ORDER BY p.date`,
    [invoiceId],
  );
  return { invoice, lines, payments };
}

export function companySalesTotals(companyId: number) {
  return one<{ invoiced: number; paid: number; outstanding: number; overdue: number; count: number }>(
    `SELECT COALESCE(SUM(total),0) AS invoiced, COALESCE(SUM(amount_paid),0) AS paid,
            COALESCE(SUM(total - amount_paid),0) AS outstanding,
            COALESCE(SUM(CASE WHEN due_date < date('now') AND total > amount_paid THEN total - amount_paid ELSE 0 END),0) AS overdue,
            COUNT(*) AS count
       FROM invoices WHERE company_id = ? AND status NOT IN ('draft','cancelled')`,
    [companyId],
  );
}
