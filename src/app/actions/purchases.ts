"use server";

import { revalidatePath } from "next/cache";
import { requireContext, requirePermission } from "@/lib/auth/guard";
import { attempt, bool, dateOf, int, moneyOf, optInt, optStr, parseLines, str, type ActionState } from "@/lib/actions/support";
import { cancelBill, createBill, createExpense, deleteExpense, postBill, recordBillPayment, updateExpense } from "@/lib/services/purchases";
import { todayISO } from "@/lib/dates";

function revalidatePurchases() {
  revalidatePath("/purchases/bills");
  revalidatePath("/purchases/expenses");
  revalidatePath("/purchases/payables");
  revalidatePath("/purchases/suppliers");
  revalidatePath("/dashboard");
  revalidatePath("/reports/profit-loss");
}

export async function createBillAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "create");
    const lines = parseLines(form, context.currency);
    if (!lines.length) throw new Error("Add at least one line to the bill.");
    const id = createBill(
      {
        companyId: context.company.id,
        contactId: int(form, "contactId"),
        issueDate: dateOf(form, "issueDate", todayISO()),
        dueDate: dateOf(form, "dueDate", todayISO()),
        currency: str(form, "currency", context.currency),
        lines,
        notes: optStr(form, "notes"),
        warehouseId: optInt(form, "warehouseId"),
        postImmediately: !bool(form, "saveAsDraft"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidatePurchases();
    revalidatePath("/inventory/stock");
    return id;
  });
}

export async function postBillAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "approve");
    const billId = int(form, "billId");
    const result = postBill(context.company.id, billId, { userId: context.user.id, userName: context.user.name });
    revalidatePurchases();
    revalidatePath(`/purchases/bills/${billId}`);
    revalidatePath("/inventory/stock");
    return result.entryId;
  });
}

export async function payBillAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "approve");
    const billId = int(form, "billId");
    const result = recordBillPayment(
      {
        companyId: context.company.id,
        billId,
        amount: moneyOf(form, "amount", context.currency),
        date: dateOf(form, "date", todayISO()),
        bankAccountId: int(form, "bankAccountId"),
        method: str(form, "method", "bank_transfer"),
        reference: optStr(form, "reference"),
        notes: optStr(form, "notes"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidatePurchases();
    revalidatePath(`/purchases/bills/${billId}`);
    revalidatePath("/banking/accounts");
    return result.paymentId;
  });
}

export async function cancelBillAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "approve");
    const billId = int(form, "billId");
    cancelBill(context.company.id, billId, { userId: context.user.id, userName: context.user.name }, optStr(form, "reason"));
    revalidatePurchases();
    revalidatePath(`/purchases/bills/${billId}`);
    return true;
  });
}

export async function createExpenseAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "create");
    const paid = bool(form, "isPaid", true);
    const result = createExpense(
      {
        companyId: context.company.id,
        date: dateOf(form, "date", todayISO()),
        contactId: optInt(form, "contactId"),
        categoryId: optInt(form, "categoryId"),
        accountId: optInt(form, "accountId"),
        paymentAccountId: optInt(form, "paymentAccountId"),
        amount: moneyOf(form, "amount", context.currency),
        taxAmount: moneyOf(form, "taxAmount", context.currency),
        currency: str(form, "currency", context.currency),
        description: optStr(form, "description"),
        reference: optStr(form, "reference"),
        isPaid: paid,
        sourceDocumentId: optInt(form, "sourceDocumentId"),
        recurring: optStr(form, "recurringFrequency")
          ? { frequency: str(form, "recurringFrequency") as "monthly" | "quarterly" | "yearly", nextRun: dateOf(form, "date", todayISO()) }
          : null,
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidatePurchases();
    return result.expenseId;
  });
}

export async function updateExpenseAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "edit");
    const expenseId = int(form, "expenseId");
    updateExpense(
      context.company.id,
      expenseId,
      {
        date: dateOf(form, "date", todayISO()),
        contactId: optInt(form, "contactId"),
        categoryId: optInt(form, "categoryId"),
        accountId: optInt(form, "accountId"),
        paymentAccountId: optInt(form, "paymentAccountId"),
        amount: moneyOf(form, "amount", context.currency),
        taxAmount: moneyOf(form, "taxAmount", context.currency),
        description: str(form, "description"),
        reference: optStr(form, "reference"),
        isPaid: bool(form, "isPaid", true),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidatePurchases();
    return expenseId;
  });
}

export async function deleteExpenseAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "delete");
    deleteExpense(context.company.id, int(form, "expenseId"), { userId: context.user.id, userName: context.user.name });
    revalidatePurchases();
    return true;
  });
}

export type { ActionState };
