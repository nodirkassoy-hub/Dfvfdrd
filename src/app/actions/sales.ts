"use server";

import { revalidatePath } from "next/cache";
import { requireContext, requirePermission } from "@/lib/auth/guard";
import { attempt, bool, dateOf, int, moneyOf, optInt, optStr, parseLines, str, type ActionState } from "@/lib/actions/support";
import { createContact, updateContact } from "@/lib/services/contacts";
import {
  cancelInvoice,
  createInvoice,
  deleteDraftInvoice,
  duplicateInvoice,
  recordInvoicePayment,
  refreshOverdueInvoices,
  sendInvoice,
  updateInvoice,
} from "@/lib/services/sales";
import { todayISO } from "@/lib/dates";

function revalidateSales() {
  revalidatePath("/sales/invoices");
  revalidatePath("/sales/customers");
  revalidatePath("/sales/payments");
  revalidatePath("/sales/receivables");
  revalidatePath("/dashboard");
  revalidatePath("/reports/profit-loss");
}

export async function createInvoiceAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "create");
    const lines = parseLines(form, context.currency);
    if (!lines.length) throw new Error("Add at least one line with a quantity and price.");
    const id = createInvoice(
      {
        companyId: context.company.id,
        contactId: int(form, "contactId"),
        issueDate: dateOf(form, "issueDate", todayISO()),
        dueDate: dateOf(form, "dueDate", todayISO()),
        currency: str(form, "currency", context.currency),
        lines,
        notes: optStr(form, "notes"),
        terms: optStr(form, "terms"),
        warehouseId: optInt(form, "warehouseId"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    if (bool(form, "sendNow")) {
      sendInvoice(context.company.id, id, { userId: context.user.id, userName: context.user.name });
    }
    revalidateSales();
    return id;
  });
}

export async function updateInvoiceAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "edit");
    const invoiceId = int(form, "invoiceId");
    updateInvoice(
      context.company.id,
      invoiceId,
      {
        companyId: context.company.id,
        contactId: int(form, "contactId"),
        issueDate: dateOf(form, "issueDate", todayISO()),
        dueDate: dateOf(form, "dueDate", todayISO()),
        currency: str(form, "currency", context.currency),
        lines: parseLines(form, context.currency),
        notes: optStr(form, "notes"),
        terms: optStr(form, "terms"),
        warehouseId: optInt(form, "warehouseId"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    if (bool(form, "sendNow")) {
      sendInvoice(context.company.id, invoiceId, { userId: context.user.id, userName: context.user.name });
    }
    revalidateSales();
    revalidatePath(`/sales/invoices/${invoiceId}`);
    return invoiceId;
  });
}

export async function sendInvoiceAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "approve");
    const invoiceId = int(form, "invoiceId");
    const result = sendInvoice(context.company.id, invoiceId, { userId: context.user.id, userName: context.user.name });
    revalidateSales();
    revalidatePath(`/sales/invoices/${invoiceId}`);
    return result.entryId;
  });
}

export async function recordInvoicePaymentAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "approve");
    const invoiceId = int(form, "invoiceId");
    const result = recordInvoicePayment(
      {
        companyId: context.company.id,
        invoiceId,
        amount: moneyOf(form, "amount", context.currency),
        date: dateOf(form, "date", todayISO()),
        bankAccountId: int(form, "bankAccountId"),
        method: str(form, "method", "bank_transfer"),
        reference: optStr(form, "reference"),
        notes: optStr(form, "notes"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidateSales();
    revalidatePath(`/sales/invoices/${invoiceId}`);
    revalidatePath("/banking/accounts");
    return result.paymentId;
  });
}

export async function cancelInvoiceAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "approve");
    const invoiceId = int(form, "invoiceId");
    cancelInvoice(context.company.id, invoiceId, { userId: context.user.id, userName: context.user.name }, optStr(form, "reason"));
    revalidateSales();
    revalidatePath(`/sales/invoices/${invoiceId}`);
    return true;
  });
}

export async function duplicateInvoiceAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "create");
    const id = duplicateInvoice(context.company.id, int(form, "invoiceId"), { userId: context.user.id, userName: context.user.name });
    revalidateSales();
    return id;
  });
}

export async function deleteDraftInvoiceAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "delete");
    deleteDraftInvoice(context.company.id, int(form, "invoiceId"), { userId: context.user.id, userName: context.user.name });
    revalidateSales();
    return true;
  });
}

export async function refreshOverdueAction(): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    refreshOverdueInvoices(context.company.id, todayISO());
    revalidateSales();
    return true;
  });
}

export async function saveCustomerAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    const contactId = optInt(form, "contactId");
    const payload = {
      companyId: context.company.id,
      kind: str(form, "kind", "customer") as "customer" | "supplier" | "both",
      name: str(form, "name"),
      legalName: optStr(form, "legalName"),
      taxId: optStr(form, "taxId"),
      contactPerson: optStr(form, "contactPerson"),
      phone: optStr(form, "phone"),
      email: optStr(form, "email"),
      address: optStr(form, "address"),
      bankName: optStr(form, "bankName"),
      bankAccount: optStr(form, "bankAccount"),
      mfo: optStr(form, "mfo"),
      currency: str(form, "currency", context.currency),
      paymentTermsDays: int(form, "paymentTermsDays", 14),
      creditLimit: moneyOf(form, "creditLimit", context.currency),
      notes: optStr(form, "notes"),
      userId: context.user.id,
      userName: context.user.name,
    };
    if (contactId) {
      requirePermission(context, "edit");
      updateContact(context.company.id, contactId, payload, { userId: context.user.id, userName: context.user.name });
      revalidateSales();
      return contactId;
    }
    requirePermission(context, "create");
    const id = createContact(payload);
    revalidateSales();
    return id;
  });
}

export type { ActionState };
