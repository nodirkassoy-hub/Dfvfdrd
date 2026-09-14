"use server";

import { revalidatePath } from "next/cache";
import { requireContext, requirePermission } from "@/lib/auth/guard";
import { attempt, bool, dateOf, int, moneyOf, optInt, optStr, str, type ActionState } from "@/lib/actions/support";
import { createBankAccount } from "@/lib/services/company";
import {
  analyzeStatementFile,
  commitStatementImport,
  confirmMatch,
  createBankTransaction,
  createTransactionFromBankTxn,
  deleteBankTransaction,
  setBankTransactionStatus,
  type ImportPreview,
} from "@/lib/services/banking";
import { todayISO } from "@/lib/dates";
import type { ParsedStatementRow } from "@/lib/services/statement-parse";

function revalidateBanking() {
  revalidatePath("/banking/accounts");
  revalidatePath("/banking/transactions");
  revalidatePath("/banking/reconciliation");
  revalidatePath("/dashboard");
}

export async function createBankAccountAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "manage_accounting");
    const id = createBankAccount({
      companyId: context.company.id,
      name: str(form, "name"),
      kind: str(form, "kind", "bank") as "bank" | "cash",
      bankName: optStr(form, "bankName"),
      accountNumber: optStr(form, "accountNumber"),
      mfo: optStr(form, "mfo"),
      currency: str(form, "currency", context.currency),
      isDefault: bool(form, "isDefault"),
    });
    revalidateBanking();
    revalidatePath("/accounting/chart-of-accounts");
    return id;
  });
}

export async function createBankTransactionAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "create");
    const id = createBankTransaction(
      {
        companyId: context.company.id,
        bankAccountId: int(form, "bankAccountId"),
        date: dateOf(form, "date", todayISO()),
        description: str(form, "description"),
        direction: str(form, "direction", "in") as "in" | "out",
        amount: moneyOf(form, "amount", context.currency),
        counterparty: optStr(form, "counterparty"),
        reference: optStr(form, "reference"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidateBanking();
    return id;
  });
}

export async function analyzeStatementAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(async () => {
    requirePermission(context, "create");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a statement file to import.");
    if (file.size > 12 * 1024 * 1024) throw new Error("File is larger than 12 MB.");
    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = analyzeStatementFile(context.company.id, int(form, "bankAccountId"), file.name, buffer);
    return { preview, filename: file.name, bankAccountId: int(form, "bankAccountId") } as unknown;
  });
}

export async function commitImportAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "create");
    const payload = str(form, "payload");
    const parsed = JSON.parse(payload) as { rows: ParsedStatementRow[]; filename: string; source: "csv" | "xlsx" | "pdf" | "text"; detectedBank?: string | null };
    if (!parsed.rows?.length) throw new Error("No rows selected for import.");
    const result = commitStatementImport(
      {
        companyId: context.company.id,
        bankAccountId: int(form, "bankAccountId"),
        filename: parsed.filename,
        source: parsed.source,
        detectedBank: parsed.detectedBank ?? null,
        rows: parsed.rows,
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidateBanking();
    return result.batchId;
  });
}

export async function confirmMatchAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "approve");
    const targetType = str(form, "targetType", "invoice") as "invoice" | "bill" | "expense" | "account";
    const result = confirmMatch(
      {
        companyId: context.company.id,
        bankTransactionId: int(form, "bankTransactionId"),
        targetType,
        targetId: optInt(form, "targetId") ?? undefined,
        accountId: optInt(form, "accountId") ?? undefined,
        categoryId: optInt(form, "categoryId"),
        contactId: optInt(form, "contactId"),
        memo: optStr(form, "memo"),
        amount: optStr(form, "amount") ? moneyOf(form, "amount", context.currency) : undefined,
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidateBanking();
    revalidatePath("/sales/invoices");
    revalidatePath("/purchases/bills");
    return result.entryId;
  });
}

export async function createFromBankAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "create");
    const splitsRaw = str(form, "splits");
    const splits = splitsRaw
      ? (JSON.parse(splitsRaw) as { accountId: number; amount: number; memo?: string; categoryId?: number | null }[])
      : [{ accountId: int(form, "accountId"), amount: moneyOf(form, "amount", context.currency) }];
    const result = createTransactionFromBankTxn(
      {
        companyId: context.company.id,
        bankTransactionId: int(form, "bankTransactionId"),
        splits: splits.map((split) => ({ ...split, amount: Math.round(split.amount) })),
        contactId: optInt(form, "contactId"),
        memo: optStr(form, "memo"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidateBanking();
    return result.entryId;
  });
}

export async function setBankTxnStatusAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "edit");
    setBankTransactionStatus(
      context.company.id,
      int(form, "bankTransactionId"),
      str(form, "status", "ignored") as "ignored" | "unmatched",
      { userId: context.user.id, userName: context.user.name },
    );
    revalidateBanking();
    return true;
  });
}

export async function deleteBankTxnAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "delete");
    deleteBankTransaction(context.company.id, int(form, "bankTransactionId"), { userId: context.user.id, userName: context.user.name });
    revalidateBanking();
    return true;
  });
}

export type { ImportPreview };

export type { ActionState };
