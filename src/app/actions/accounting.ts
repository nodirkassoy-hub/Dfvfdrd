"use server";

import { revalidatePath } from "next/cache";
import { insert, nowISO, one, run } from "@/lib/db";
import { requireContext, requirePermission } from "@/lib/auth/guard";
import { attempt, bool, dateOf, int, moneyOf, optInt, optStr, str, type ActionState } from "@/lib/actions/support";
import { postEntry, voidEntry } from "@/lib/accounting/engine";
import { todayISO } from "@/lib/dates";
import type { AccountType } from "@/lib/accounting/coa";

function revalidateAccounting(id?: number) {
  revalidatePath("/accounting/chart-of-accounts");
  revalidatePath("/accounting/journal-entries");
  revalidatePath("/accounting/trial-balance");
  revalidatePath("/accounting/general-ledger");
  revalidatePath("/accounting/transactions");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/accounting/journal-entries/${id}`);
}

export async function saveAccountAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "manage_accounting");
    const accountId = optInt(form, "accountId");
    const payload = {
      code: str(form, "code"),
      name: str(form, "name"),
      type: str(form, "type", "expense") as AccountType,
      subtype: optStr(form, "subtype") ?? null,
      parentId: optInt(form, "parentId"),
      isPostable: bool(form, "isPostable", true) ? 1 : 0,
      currency: str(form, "currency", context.currency),
      description: optStr(form, "description") ?? null,
    };

    if (accountId) {
      run(
        `UPDATE accounts SET code = ?, name = ?, type = ?, subtype = ?, parent_id = ?, is_postable = ?, currency = ?, description = ?
          WHERE id = ? AND company_id = ?`,
        [payload.code, payload.name, payload.type, payload.subtype, payload.parentId, payload.isPostable, payload.currency, payload.description, accountId, context.company.id],
      );
      revalidateAccounting();
      return accountId;
    }

    const id = insert(
      `INSERT INTO accounts (company_id, code, name, type, subtype, parent_id, is_postable, currency, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [context.company.id, payload.code, payload.name, payload.type, payload.subtype, payload.parentId, payload.isPostable, payload.currency, payload.description, nowISO()],
    );

    const openingBalance = moneyOf(form, "openingBalance", context.currency);
    if (openingBalance !== 0) {
      const equity = one<{ id: number }>("SELECT id FROM accounts WHERE company_id = ? AND code = '3090'", [context.company.id]);
      if (equity) {
        postEntry({
          companyId: context.company.id,
          date: dateOf(form, "openingDate", todayISO()),
          memo: `Opening balance for ${payload.code} ${payload.name}`,
          sourceType: "opening",
          sourceId: id,
          userId: context.user.id,
          lines:
            openingBalance > 0
              ? [
                  { accountId: id, debit: openingBalance, description: "Opening balance" },
                  { accountId: equity.id, credit: openingBalance, description: "Opening balance offset" },
                ]
              : [
                  { accountId: equity.id, debit: Math.abs(openingBalance), description: "Opening balance offset" },
                  { accountId: id, credit: Math.abs(openingBalance), description: "Opening balance" },
                ],
        });
      }
    }

    revalidateAccounting();
    return id;
  });
}

export async function archiveAccountAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "manage_accounting");
    const accountId = int(form, "accountId");
    const used = one<{ count: number }>(
      `SELECT (SELECT COUNT(*) FROM journal_lines WHERE account_id = ?) +
              (SELECT COUNT(*) FROM bank_accounts WHERE account_id = ?) +
              (SELECT COUNT(*) FROM categories WHERE account_id = ?) AS count`,
      [accountId, accountId, accountId],
    );
    if ((used?.count ?? 0) > 0) {
      run("UPDATE accounts SET is_archived = 1 WHERE id = ? AND company_id = ?", [accountId, context.company.id]);
    } else {
      run("DELETE FROM accounts WHERE id = ? AND company_id = ? AND is_system = 0", [accountId, context.company.id]);
    }
    revalidateAccounting();
    return true;
  });
}

export async function createJournalEntryAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "manage_accounting");
    const raw = str(form, "lines");
    const parsed = raw ? (JSON.parse(raw) as { accountId: number; debit?: number; credit?: number; description?: string }[]) : [];
    const entry = postEntry({
      companyId: context.company.id,
      date: dateOf(form, "date", todayISO()),
      memo: str(form, "memo"),
      sourceType: "manual",
      userId: context.user.id,
      lines: parsed
        .filter((line) => line.accountId && (Number(line.debit) > 0 || Number(line.credit) > 0))
        .map((line) => ({
          accountId: Number(line.accountId),
          debit: Math.round(Number(line.debit ?? 0)),
          credit: Math.round(Number(line.credit ?? 0)),
          description: line.description,
        })),
    });
    revalidateAccounting(entry.id);
    return entry.id;
  });
}

export async function voidEntryAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "manage_accounting");
    const entryId = int(form, "entryId");
    voidEntry(entryId, context.user.id, optStr(form, "reason"));
    revalidateAccounting(entryId);
    return true;
  });
}

export type { ActionState };
