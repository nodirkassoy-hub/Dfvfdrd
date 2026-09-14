"use server";

import { revalidatePath } from "next/cache";
import { requireContext, requirePermission } from "@/lib/auth/guard";
import { attempt, bool, int, moneyOf, optInt, optStr, str, type ActionState } from "@/lib/actions/support";
import {
  closePeriod,
  createBudget,
  createTask,
  deleteBudget,
  deleteTask,
  generateNotifications,
  generateTasks,
  listAlerts,
  markAllNotificationsRead,
  markNotificationRead,
  monthlyBreakdownForSafe,
  reopenPeriod,
  runXatoRadar,
  updateAlertStatus,
  updateTaskStatus,
} from "@/lib/services/operations-bridge";
import { periodFromParams } from "@/lib/services/intelligence";

function revalidateIntelligence() {
  revalidatePath("/ai-center/xato-radar");
  revalidatePath("/my-work");
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
}

export async function runRadarAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "view");
    const period = periodFromParams(context.company.id, { preset: str(form, "period", "this_month") }, context.locale);
    const result = runXatoRadar(context.company.id, period, { userId: context.user.id, userName: context.user.name });
    generateTasks(context.company.id, period, { userId: context.user.id, userName: context.user.name });
    generateNotifications(context.company.id, period);
    revalidateIntelligence();
    return result.created;
  });
}

export async function alertStatusAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "edit");
    updateAlertStatus(
      context.company.id,
      int(form, "alertId"),
      str(form, "status", "resolved") as "open" | "reviewing" | "resolved" | "ignored",
      { userId: context.user.id, userName: context.user.name },
    );
    revalidateIntelligence();
    return true;
  });
}

export async function taskStatusAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "edit");
    updateTaskStatus(context.company.id, int(form, "taskId"), str(form, "status", "completed") as "todo" | "in_progress" | "completed");
    revalidateIntelligence();
    return true;
  });
}

export async function createTaskAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "create");
    const id = createTask(
      context.company.id,
      {
        title: str(form, "title"),
        description: optStr(form, "description"),
        priority: str(form, "priority", "medium"),
        dueDate: optStr(form, "dueDate") ?? null,
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidateIntelligence();
    return id;
  });
}

export async function deleteTaskAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "delete");
    deleteTask(context.company.id, int(form, "taskId"));
    revalidateIntelligence();
    return true;
  });
}

export async function refreshTasksAction(): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    const period = periodFromParams(context.company.id, {}, context.locale);
    const created = generateTasks(context.company.id, period, { userId: context.user.id, userName: context.user.name });
    generateNotifications(context.company.id, period);
    revalidateIntelligence();
    return created;
  });
}

export async function notificationReadAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    const id = optInt(form, "notificationId");
    if (id) markNotificationRead(context.company.id, id);
    else markAllNotificationsRead(context.company.id);
    revalidateIntelligence();
    return true;
  });
}

export async function closePeriodAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "approve");
    closePeriod(context.company.id, str(form, "period"), { userId: context.user.id, userName: context.user.name });
    revalidatePath("/month-end-close");
    revalidatePath("/dashboard");
    return true;
  });
}

export async function reopenPeriodAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "manage_accounting");
    reopenPeriod(context.company.id, str(form, "period"), { userId: context.user.id, userName: context.user.name });
    revalidatePath("/month-end-close");
    return true;
  });
}

export async function createBudgetAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "manage_reports");
    const id = createBudget(
      {
        companyId: context.company.id,
        name: str(form, "name"),
        periodType: str(form, "periodType", "month") as "month" | "quarter" | "year",
        year: int(form, "year", new Date().getFullYear()),
        periodIndex: int(form, "periodIndex", 1),
        scope: str(form, "scope", "category") as "company" | "department" | "category" | "account",
        departmentId: optInt(form, "departmentId"),
        categoryId: optInt(form, "categoryId"),
        accountId: optInt(form, "accountId"),
        amount: moneyOf(form, "amount", context.currency),
        notes: optStr(form, "notes"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidatePath("/budgeting");
    revalidatePath("/reports/budget-vs-actual");
    return id;
  });
}

export async function deleteBudgetAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "manage_reports");
    deleteBudget(context.company.id, int(form, "budgetId"), { userId: context.user.id, userName: context.user.name });
    revalidatePath("/budgeting");
    return true;
  });
}

void bool;
void moneyOf;
void listAlerts;
void monthlyBreakdownForSafe;

export type { ActionState };
