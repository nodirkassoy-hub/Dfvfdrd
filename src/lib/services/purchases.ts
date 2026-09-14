/**
 * Purchase cycle: bill / expense → journal entry → payable → payment.
 *
 *   Bill received   Dr Inventory (1201) or expense account   net per line
 *                   Dr Input VAT (1400)                      tax
 *                   Cr Trade payables (2011)                 total
 *
 *   Expense paid    Dr Expense account                       net
 *                   Dr Input VAT (1400)                      tax
 *                   Cr Bank / cash account                   total
 *
 *   Bill payment    Dr Trade payables                        amount
 *                   Cr Bank / cash account                   amount
 */
import { all, insert, nowISO, one, run, tx } from "@/lib/db";
import { ValidationError } from "@/lib/accounting/errors";
import { SYSTEM_ACCOUNTS } from "@/lib/accounting/coa";
import { accountIdByCodeOrThrow, nextDocumentNumber, postEntryTx, voidEntry } from "@/lib/accounting/engine";
import { computeDocument, type LineInput } from "./line-math";
import { recordAudit } from "./company";
import { recordStockMove } from "./inventory";

export type Ctx = { userId?: number | null; userName?: string | null; ip?: string | null };

/* ------------------------------------------------------------------- bills */
export type BillInput = {
  companyId: number;
  contactId: number;
  issueDate: string;
  dueDate: string;
  currency?: string;
  fxRateMicro?: number;
  lines: LineInput[];
  notes?: string;
  warehouseId?: number | null;
  number?: string;
  postImmediately?: boolean;
};

export function createBill(input: BillInput, ctx: Ctx = {}): number {
  if (!input.lines?.length) throw new ValidationError("NO_LINES", "A bill needs at least one line");
  if (input.dueDate < input.issueDate) throw new ValidationError("DATE_ORDER", "Due date cannot be before the bill date");
  const supplier = one<{ id: number }>("SELECT id FROM contacts WHERE id = ? AND company_id = ?", [input.contactId, input.companyId]);
  if (!supplier) throw new ValidationError("CONTACT_NOT_FOUND", "Supplier not found");

  return tx(() => {
    const stamp = nowISO();
    const currency = input.currency ?? "UZS";
    const computed = computeDocument(input.lines, currency);
    const number = input.number ?? nextDocumentNumber(input.companyId, "bill", "BILL");

    const billId = insert(
      `INSERT INTO bills
        (company_id, number, contact_id, issue_date, due_date, currency, fx_rate_micro, status, subtotal, tax_total,
         total, amount_paid, notes, warehouse_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        input.companyId,
        number,
        input.contactId,
        input.issueDate,
        input.dueDate,
        currency,
        input.fxRateMicro ?? 1_000_000,
        computed.subtotal,
        computed.taxTotal,
        computed.total,
        input.notes ?? null,
        input.warehouseId ?? null,
        ctx.userId ?? null,
        stamp,
        stamp,
      ],
    );

    const inventoryAccount = accountIdByCodeOrThrow(input.companyId, SYSTEM_ACCOUNTS.INVENTORY);
    const defaultExpense = accountIdByCodeOrThrow(input.companyId, "6190");
    computed.lines.forEach((line, index) => {
      insert(
        `INSERT INTO bill_lines
          (bill_id, line_no, product_id, description, qty_milli, unit_price, discount, tax_code_id, tax_rate_bp,
           tax_amount, net_amount, line_total, account_id, warehouse_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          billId,
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
          line.accountId ?? (line.productId ? inventoryAccount : defaultExpense),
          line.warehouseId ?? input.warehouseId ?? null,
        ],
      );
    });

    recordAudit({
      companyId: input.companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "create",
      entityType: "bill",
      entityId: billId,
      summary: `Created supplier bill ${number}`,
      after: { number, total: computed.total },
    });

    if (input.postImmediately) postBill(input.companyId, billId, ctx);
    return billId;
  });
}

export function postBill(companyId: number, billId: number, ctx: Ctx = {}): { entryId: number } {
  return tx(() => {
    const bill = one<{
      id: number;
      number: string;
      contact_id: number;
      issue_date: string;
      currency: string;
      fx_rate_micro: number;
      tax_total: number;
      total: number;
      journal_entry_id: number | null;
      warehouse_id: number | null;
      status: string;
    }>("SELECT * FROM bills WHERE id = ? AND company_id = ?", [billId, companyId]);
    if (!bill) throw new ValidationError("NOT_FOUND", "Bill not found");
    if (bill.journal_entry_id) throw new ValidationError("ALREADY_POSTED", "This bill is already posted");
    if (bill.status === "cancelled") throw new ValidationError("CANCELLED", "Cancelled bills cannot be posted");

    const lines = all<{
      product_id: number | null;
      account_id: number | null;
      description: string;
      net_amount: number;
      qty_milli: number;
      unit_price: number;
      tax_amount: number;
      tax_code_id: number | null;
      warehouse_id: number | null;
      line_total: number;
    }>("SELECT * FROM bill_lines WHERE bill_id = ? ORDER BY line_no", [billId]);

    const inventoryAccount = accountIdByCodeOrThrow(companyId, SYSTEM_ACCOUNTS.INVENTORY);
    const apAccount = accountIdByCodeOrThrow(companyId, SYSTEM_ACCOUNTS.AP_TRADE);
    const inputVat = accountIdByCodeOrThrow(companyId, SYSTEM_ACCOUNTS.INPUT_VAT);

    const entry = postEntryTx({
      companyId,
      date: bill.issue_date,
      memo: `Supplier bill ${bill.number}`,
      reference: bill.number,
      sourceType: "bill",
      sourceId: billId,
      currency: bill.currency,
      fxRateMicro: bill.fx_rate_micro,
      userId: ctx.userId ?? null,
      lines: [
        ...lines.map((line) => ({
          accountId: line.account_id ?? inventoryAccount,
          debit: line.net_amount,
          description: line.description,
          currency: bill.currency,
          fxRateMicro: bill.fx_rate_micro,
          contactType: "supplier" as const,
          contactId: bill.contact_id,
          productId: line.product_id,
          taxCodeId: line.tax_code_id,
          taxAmount: line.tax_amount,
          docType: "bill",
          docId: billId,
        })),
        ...(bill.tax_total > 0
          ? [
              {
                accountId: inputVat,
                debit: bill.tax_total,
                description: `Input VAT — bill ${bill.number}`,
                currency: bill.currency,
                fxRateMicro: bill.fx_rate_micro,
                taxAmount: bill.tax_total,
                docType: "bill" as const,
                docId: billId,
              },
            ]
          : []),
        {
          accountId: apAccount,
          credit: bill.total,
          description: `Bill ${bill.number}`,
          currency: bill.currency,
          fxRateMicro: bill.fx_rate_micro,
          contactType: "supplier",
          contactId: bill.contact_id,
          docType: "bill",
          docId: billId,
        },
      ],
    });

    run("UPDATE bills SET journal_entry_id = ?, status = 'open', updated_at = ? WHERE id = ?", [entry.id, nowISO(), billId]);

    // Purchased goods enter inventory at their purchase cost.
    const defaultWarehouse = one<{ id: number }>(
      "SELECT id FROM warehouses WHERE company_id = ? ORDER BY is_default DESC, id LIMIT 1",
      [companyId],
    );
    for (const line of lines) {
      if (!line.product_id) continue;
      const warehouseId = line.warehouse_id ?? bill.warehouse_id ?? defaultWarehouse?.id;
      if (!warehouseId) continue;
      const unitCost = line.qty_milli ? Math.round((line.net_amount * 1000) / line.qty_milli) : line.unit_price;
      recordStockMove({
        companyId,
        productId: line.product_id,
        warehouseId,
        date: bill.issue_date,
        direction: "in",
        qtyMilli: line.qty_milli,
        unitCost,
        refType: "bill",
        refId: billId,
        ctx,
      });
    }

    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "post",
      entityType: "bill",
      entityId: billId,
      summary: `Posted supplier bill ${bill.number} (entry ${entry.number})`,
      after: { entryId: entry.id, total: bill.total },
    });
    return { entryId: entry.id };
  });
}

export function recordBillPayment(
  input: { companyId: number; billId: number; amount: number; date: string; bankAccountId: number; method?: string; reference?: string; notes?: string },
  ctx: Ctx = {},
): { paymentId: number; entryId: number } {
  if (input.amount <= 0) throw new ValidationError("AMOUNT_ZERO", "Payment amount must be greater than zero");
  return tx(() => {
    const bill = one<{ id: number; number: string; contact_id: number; currency: string; total: number; amount_paid: number; status: string }>(
      "SELECT id, number, contact_id, currency, total, amount_paid, status FROM bills WHERE id = ? AND company_id = ?",
      [input.billId, input.companyId],
    );
    if (!bill) throw new ValidationError("NOT_FOUND", "Bill not found");
    if (input.amount > bill.total - bill.amount_paid) throw new ValidationError("OVERPAYMENT", "Payment exceeds the outstanding amount on this bill");

    const bankAccount = one<{ id: number; account_id: number }>(
      "SELECT id, account_id FROM bank_accounts WHERE id = ? AND company_id = ?",
      [input.bankAccountId, input.companyId],
    );
    if (!bankAccount) throw new ValidationError("ACCOUNT_NOT_FOUND", "Payment account not found");

    const number = nextDocumentNumber(input.companyId, "payment", "PAY");
    const entry = postEntryTx({
      companyId: input.companyId,
      date: input.date,
      memo: `Payment for bill ${bill.number}`,
      reference: input.reference ?? bill.number,
      sourceType: "payment",
      sourceId: bill.id,
      currency: bill.currency,
      userId: ctx.userId ?? null,
      lines: [
        {
          accountId: accountIdByCodeOrThrow(input.companyId, SYSTEM_ACCOUNTS.AP_TRADE),
          debit: input.amount,
          description: `Settled bill ${bill.number}`,
          currency: bill.currency,
          contactType: "supplier",
          contactId: bill.contact_id,
          docType: "bill",
          docId: bill.id,
        },
        {
          accountId: bankAccount.account_id,
          credit: input.amount,
          description: `Payment for bill ${bill.number}`,
          currency: bill.currency,
          contactType: "supplier",
          contactId: bill.contact_id,
        },
      ],
    });

    const paymentId = insert(
      `INSERT INTO payments (company_id, number, kind, contact_id, date, amount, currency, method, account_id, bill_id,
        reference, notes, journal_entry_id, created_by, created_at)
       VALUES (?, ?, 'outgoing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.companyId,
        number,
        bill.contact_id,
        input.date,
        input.amount,
        bill.currency,
        input.method ?? "bank_transfer",
        bankAccount.id,
        bill.id,
        input.reference ?? null,
        input.notes ?? null,
        entry.id,
        ctx.userId ?? null,
        nowISO(),
      ],
    );

    const paid = bill.amount_paid + input.amount;
    run("UPDATE bills SET amount_paid = ?, status = ?, updated_at = ? WHERE id = ?", [
      paid,
      paid >= bill.total ? "paid" : "open",
      nowISO(),
      bill.id,
    ]);
    recordAudit({
      companyId: input.companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "payment",
      entityType: "bill",
      entityId: bill.id,
      summary: `Paid bill ${bill.number}: ${input.amount}`,
      before: { amountPaid: bill.amount_paid },
      after: { amountPaid: paid, entryId: entry.id },
    });
    return { paymentId, entryId: entry.id };
  });
}

export function cancelBill(companyId: number, billId: number, ctx: Ctx = {}, reason?: string): void {
  return tx(() => {
    const bill = one<{ number: string; journal_entry_id: number | null; amount_paid: number }>(
      "SELECT number, journal_entry_id, amount_paid FROM bills WHERE id = ? AND company_id = ?",
      [billId, companyId],
    );
    if (!bill) throw new ValidationError("NOT_FOUND", "Bill not found");
    if (bill.amount_paid > 0) throw new ValidationError("HAS_PAYMENTS", "Reverse the payments before cancelling this bill");
    if (bill.journal_entry_id) voidEntry(bill.journal_entry_id, ctx.userId ?? null, reason ?? `Bill ${bill.number} cancelled`);
    // Reverse the stock receipt so inventory matches the ledger again.
    const moves = all<{ id: number; product_id: number; warehouse_id: number; qty_milli: number; unit_cost: number; date: string }>(
      "SELECT id, product_id, warehouse_id, qty_milli, unit_cost, date FROM stock_moves WHERE ref_type = 'bill' AND ref_id = ? AND direction = 'in'",
      [billId],
    );
    for (const move of moves) {
      recordStockMove({
        companyId,
        productId: move.product_id,
        warehouseId: move.warehouse_id,
        date: move.date,
        direction: "adjust_out",
        qtyMilli: move.qty_milli,
        unitCost: move.unit_cost,
        refType: "bill-cancel",
        refId: billId,
        ctx,
      });
    }
    run("UPDATE bills SET status = 'cancelled', updated_at = ? WHERE id = ?", [nowISO(), billId]);
  });
}

/* ---------------------------------------------------------------- expenses */
export type ExpenseInput = {
  companyId: number;
  date: string;
  contactId?: number | null;
  categoryId?: number | null;
  accountId?: number | null;
  paymentAccountId?: number | null;
  amount: number; // net, minor units
  taxAmount?: number;
  currency?: string;
  fxRateMicro?: number;
  description?: string;
  reference?: string;
  isPaid?: boolean;
  recurring?: { frequency: "monthly" | "quarterly" | "yearly"; nextRun: string } | null;
  sourceDocumentId?: number | null;
  aiSuggested?: boolean;
  number?: string;
};

export function createExpense(input: ExpenseInput, ctx: Ctx = {}): { expenseId: number; entryId: number | null } {
  if (input.amount <= 0) throw new ValidationError("AMOUNT_ZERO", "Expense amount must be greater than zero");
  return tx(() => {
    const currency = input.currency ?? "UZS";
    const accountId = input.accountId ?? (input.categoryId ? categoryAccount(input.companyId, input.categoryId) : null);
    if (!accountId) throw new ValidationError("ACCOUNT_REQUIRED", "Choose an expense category or account");
    const isPaid = input.isPaid !== false;
    if (isPaid && !input.paymentAccountId) throw new ValidationError("ACCOUNT_REQUIRED", "Choose the account the expense was paid from");

    const number = input.number ?? nextDocumentNumber(input.companyId, "expense", "EXP");
    const taxAmount = Math.round(input.taxAmount ?? 0);

    const expenseId = insert(
      `INSERT INTO expenses
        (company_id, number, date, contact_id, category_id, account_id, payment_account_id, amount, tax_amount, currency,
         fx_rate_micro, description, reference, status, is_paid, recurring, source_document_id, ai_suggested, created_by,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.companyId,
        number,
        input.date,
        input.contactId ?? null,
        input.categoryId ?? null,
        accountId,
        input.paymentAccountId ?? null,
        input.amount,
        taxAmount,
        currency,
        input.fxRateMicro ?? 1_000_000,
        input.description ?? null,
        input.reference ?? null,
        isPaid ? 1 : 0,
        input.recurring ? JSON.stringify(input.recurring) : null,
        input.sourceDocumentId ?? null,
        input.aiSuggested ? 1 : 0,
        ctx.userId ?? null,
        nowISO(),
        nowISO(),
      ],
    );

    const entry = postExpenseEntry(expenseId, ctx);
    return { expenseId, entryId: entry?.id ?? null };
  });
}

export function categoryAccount(companyId: number, categoryId: number): number | null {
  const row = one<{ account_id: number | null }>("SELECT account_id FROM categories WHERE id = ? AND company_id = ?", [
    categoryId,
    companyId,
  ]);
  return row?.account_id ?? null;
}

function postExpenseEntry(expenseId: number, ctx: Ctx) {
  const expense = one<{
    id: number;
    company_id: number;
    date: string;
    contact_id: number | null;
    account_id: number;
    payment_account_id: number | null;
    amount: number;
    tax_amount: number;
    currency: string;
    fx_rate_micro: number;
    description: string | null;
    is_paid: number;
    number: string;
  }>("SELECT * FROM expenses WHERE id = ?", [expenseId]);
  if (!expense) throw new ValidationError("NOT_FOUND", "Expense not found");

  const vatAccount = accountIdByCodeOrThrow(expense.company_id, SYSTEM_ACCOUNTS.INPUT_VAT);
  const payableAccount = accountIdByCodeOrThrow(expense.company_id, SYSTEM_ACCOUNTS.AP_TRADE);
  const total = expense.amount + expense.tax_amount;

  let creditAccount: number;
  if (expense.is_paid) {
    const bank = one<{ account_id: number }>("SELECT account_id FROM bank_accounts WHERE id = ? AND company_id = ?", [
      expense.payment_account_id,
      expense.company_id,
    ]);
    if (!bank) throw new ValidationError("ACCOUNT_NOT_FOUND", "Payment account not found");
    creditAccount = bank.account_id;
  } else {
    creditAccount = payableAccount;
  }

  const entry = postEntryTx({
    companyId: expense.company_id,
    date: expense.date,
    memo: expense.description ?? `Expense ${expense.number}`,
    reference: expense.number,
    sourceType: "expense",
    sourceId: expense.id,
    currency: expense.currency,
    fxRateMicro: expense.fx_rate_micro,
    userId: ctx.userId ?? null,
    lines: [
      {
        accountId: expense.account_id,
        debit: expense.amount,
        description: expense.description ?? undefined,
        currency: expense.currency,
        fxRateMicro: expense.fx_rate_micro,
        contactType: expense.contact_id ? "supplier" : null,
        contactId: expense.contact_id,
        docType: "expense",
        docId: expense.id,
      },
      ...(expense.tax_amount > 0
        ? [
            {
              accountId: vatAccount,
              debit: expense.tax_amount,
              description: `Input VAT on ${expense.number}`,
              currency: expense.currency,
              fxRateMicro: expense.fx_rate_micro,
              taxAmount: expense.tax_amount,
              docType: "expense" as const,
              docId: expense.id,
            },
          ]
        : []),
      {
        accountId: creditAccount,
        credit: total,
        description: expense.is_paid ? `Paid ${expense.number}` : `Payable ${expense.number}`,
        currency: expense.currency,
        fxRateMicro: expense.fx_rate_micro,
        contactType: expense.contact_id && !expense.is_paid ? "supplier" : null,
        contactId: expense.is_paid ? null : expense.contact_id,
        docType: "expense",
        docId: expense.id,
      },
    ],
  });

  run("UPDATE expenses SET journal_entry_id = ?, updated_at = ? WHERE id = ?", [entry.id, nowISO(), expenseId]);
  recordAudit({
    companyId: expense.company_id,
    userId: ctx.userId,
    userName: ctx.userName,
    action: "create",
    entityType: "expense",
    entityId: expenseId,
    summary: `Recorded expense ${expense.number} (${total})`,
    after: { entryId: entry.id, total },
  });
  return entry;
}

export function updateExpense(
  companyId: number,
  expenseId: number,
  patch: Partial<ExpenseInput> & { date?: string; description?: string },
  ctx: Ctx = {},
): void {
  return tx(() => {
    const existing = one<Record<string, unknown>>("SELECT * FROM expenses WHERE id = ? AND company_id = ?", [expenseId, companyId]);
    if (!existing) throw new ValidationError("NOT_FOUND", "Expense not found");
    if (existing.journal_entry_id) {
      voidEntry(Number(existing.journal_entry_id), ctx.userId ?? null, "Expense edited");
    }
    run(
      `UPDATE expenses SET date = ?, contact_id = ?, category_id = ?, account_id = ?, payment_account_id = ?, amount = ?,
        tax_amount = ?, description = ?, reference = ?, is_paid = ?, journal_entry_id = NULL, updated_at = ?
        WHERE id = ? AND company_id = ?`,
      [
        patch.date ?? existing.date,
        patch.contactId ?? existing.contact_id,
        patch.categoryId ?? existing.category_id,
        patch.accountId ?? existing.account_id,
        patch.paymentAccountId ?? existing.payment_account_id,
        Math.round(patch.amount ?? Number(existing.amount)),
        Math.round(patch.taxAmount ?? Number(existing.tax_amount)),
        patch.description ?? existing.description,
        patch.reference ?? existing.reference,
        patch.isPaid === undefined ? existing.is_paid : patch.isPaid ? 1 : 0,
        nowISO(),
        expenseId,
        companyId,
      ],
    );
    postExpenseEntry(expenseId, ctx);
    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "update",
      entityType: "expense",
      entityId: expenseId,
      summary: "Expense updated and re-posted",
      before: existing,
      after: patch,
      ip: ctx.ip,
    });
  });
}

export function deleteExpense(companyId: number, expenseId: number, ctx: Ctx = {}): void {
  return tx(() => {
    const existing = one<{ number: string; journal_entry_id: number | null }>(
      "SELECT number, journal_entry_id FROM expenses WHERE id = ? AND company_id = ?",
      [expenseId, companyId],
    );
    if (!existing) throw new ValidationError("NOT_FOUND", "Expense not found");
    if (existing.journal_entry_id) voidEntry(existing.journal_entry_id, ctx.userId ?? null, "Expense deleted");
    run("DELETE FROM expenses WHERE id = ? AND company_id = ?", [expenseId, companyId]);
    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "delete",
      entityType: "expense",
      entityId: expenseId,
      summary: `Deleted expense ${existing.number} (entry reversed)`,
      ip: ctx.ip,
    });
  });
}

export type ExpenseRow = {
  id: number;
  number: string;
  date: string;
  description: string | null;
  amount: number;
  taxAmount: number;
  total: number;
  currency: string;
  categoryName: string | null;
  categoryId: number | null;
  accountCode: string;
  accountName: string;
  supplierName: string | null;
  supplierId: number | null;
  paidFromName: string | null;
  isPaid: number;
  journalEntryId: number | null;
  entryNumber: string | null;
  isRecurring: number;
  hasDocument: number;
  aiSuggested: number;
};

export function listExpenses(
  companyId: number,
  filters: { from?: string; to?: string; categoryId?: number; contactId?: number; search?: string; limit?: number; accountId?: number } = {},
): ExpenseRow[] {
  const conditions = ["x.company_id = ?"];
  const params: unknown[] = [companyId];
  if (filters.from) {
    conditions.push("x.date >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push("x.date <= ?");
    params.push(filters.to);
  }
  if (filters.categoryId) {
    conditions.push("x.category_id = ?");
    params.push(filters.categoryId);
  }
  if (filters.accountId) {
    conditions.push("x.account_id = ?");
    params.push(filters.accountId);
  }
  if (filters.contactId) {
    conditions.push("x.contact_id = ?");
    params.push(filters.contactId);
  }
  if (filters.search) {
    conditions.push("(x.description LIKE ? OR x.number LIKE ? OR c.name LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
  }
  params.push(filters.limit ?? 300);

  return all<ExpenseRow>(
    `SELECT x.id, x.number, x.date, x.description, x.amount, x.tax_amount AS taxAmount, x.amount + x.tax_amount AS total,
            x.currency, cat.name AS categoryName, x.category_id AS categoryId, a.code AS accountCode, a.name AS accountName,
            c.name AS supplierName, x.contact_id AS supplierId, b.name AS paidFromName, x.is_paid AS isPaid,
            x.journal_entry_id AS journalEntryId, e.number AS entryNumber,
            CASE WHEN x.recurring IS NOT NULL THEN 1 ELSE 0 END AS isRecurring,
            CASE WHEN x.source_document_id IS NOT NULL THEN 1 ELSE 0 END AS hasDocument,
            x.ai_suggested AS aiSuggested
       FROM expenses x
       JOIN accounts a ON a.id = x.account_id
       LEFT JOIN categories cat ON cat.id = x.category_id
       LEFT JOIN contacts c ON c.id = x.contact_id
       LEFT JOIN bank_accounts b ON b.id = x.payment_account_id
       LEFT JOIN journal_entries e ON e.id = x.journal_entry_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY x.date DESC, x.id DESC
      LIMIT ?`,
    params,
  );
}

export function expenseTotals(companyId: number, from: string, to: string) {
  return one<{ total: number; tax: number; count: number }>(
    `SELECT COALESCE(SUM(amount),0) AS total, COALESCE(SUM(tax_amount),0) AS tax, COUNT(*) AS count
       FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ?`,
    [companyId, from, to],
  );
}

export function listBills(
  companyId: number,
  filters: { status?: string; contactId?: number; from?: string; to?: string; search?: string; limit?: number } = {},
) {
  const conditions = ["b.company_id = ?"];
  const params: unknown[] = [companyId];
  if (filters.status && filters.status !== "all") {
    conditions.push("b.status = ?");
    params.push(filters.status);
  }
  if (filters.contactId) {
    conditions.push("b.contact_id = ?");
    params.push(filters.contactId);
  }
  if (filters.from) {
    conditions.push("b.issue_date >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push("b.issue_date <= ?");
    params.push(filters.to);
  }
  if (filters.search) {
    conditions.push("(b.number LIKE ? OR c.name LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  params.push(filters.limit ?? 300);
  return all<{
    id: number;
    number: string;
    status: string;
    issueDate: string;
    dueDate: string;
    currency: string;
    total: number;
    amountPaid: number;
    amountDue: number;
    supplierId: number;
    supplierName: string;
    journalEntryId: number | null;
    daysOverdue: number;
  }>(
    `SELECT b.id, b.number, b.status, b.issue_date AS issueDate, b.due_date AS dueDate, b.currency, b.total,
            b.amount_paid AS amountPaid, b.total - b.amount_paid AS amountDue, b.contact_id AS supplierId,
            c.name AS supplierName, b.journal_entry_id AS journalEntryId,
            CASE WHEN b.due_date < date('now') AND b.total > b.amount_paid
                 THEN CAST(julianday(date('now')) - julianday(b.due_date) AS INTEGER) ELSE 0 END AS daysOverdue
       FROM bills b JOIN contacts c ON c.id = b.contact_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY b.issue_date DESC, b.id DESC
      LIMIT ?`,
    params,
  );
}

export function getBillDetail(companyId: number, billId: number) {
  const bill = one<Record<string, unknown>>(
    `SELECT b.*, c.name AS supplierName, c.tax_id AS supplierTaxId, e.number AS entryNumber, e.id AS entryId
       FROM bills b JOIN contacts c ON c.id = b.contact_id
       LEFT JOIN journal_entries e ON e.id = b.journal_entry_id
      WHERE b.id = ? AND b.company_id = ?`,
    [billId, companyId],
  );
  if (!bill) return undefined;
  const lines = all(
    `SELECT bl.*, p.name AS productName, p.sku, a.code AS accountCode, a.name AS accountName
       FROM bill_lines bl LEFT JOIN products p ON p.id = bl.product_id LEFT JOIN accounts a ON a.id = bl.account_id
      WHERE bl.bill_id = ? ORDER BY bl.line_no`,
    [billId],
  );
  const payments = all(
    `SELECT p.id, p.number, p.date, p.amount, p.method, p.reference, p.journal_entry_id AS journalEntryId
       FROM payments p WHERE p.bill_id = ? ORDER BY p.date`,
    [billId],
  );
  return { bill, lines, payments };
}
