"use server";

import { revalidatePath } from "next/cache";
import { requireContext, requirePermission } from "@/lib/auth/guard";
import { attempt, dateOf, int, moneyOf, optInt, optStr, str, type ActionState } from "@/lib/actions/support";
import { createAdvance, createEmployee, createPayrollRun, payPayrollRun, updateEmployee } from "@/lib/services/payroll";
import { todayISO } from "@/lib/dates";

function revalidateHr() {
  revalidatePath("/employees/employees");
  revalidatePath("/employees/payroll");
  revalidatePath("/employees/advances");
  revalidatePath("/dashboard");
}

export async function saveEmployeeAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    const employeeId = optInt(form, "employeeId");
    if (employeeId) {
      requirePermission(context, "edit");
      updateEmployee(
        context.company.id,
        employeeId,
        {
          fullName: str(form, "fullName"),
          position: optStr(form, "position"),
          departmentId: optInt(form, "departmentId"),
          hireDate: str(form, "hireDate") || undefined,
          grossSalary: moneyOf(form, "grossSalary", context.currency),
          taxId: optStr(form, "taxId"),
          inpsNumber: optStr(form, "inpsNumber"),
          bankAccount: optStr(form, "bankAccount"),
          phone: optStr(form, "phone"),
          email: optStr(form, "email"),
          status: str(form, "status", "active"),
        },
        { userId: context.user.id, userName: context.user.name },
      );
      revalidateHr();
      return employeeId;
    }
    requirePermission(context, "create");
    const id = createEmployee(
      {
        companyId: context.company.id,
        fullName: str(form, "fullName"),
        position: optStr(form, "position"),
        departmentId: optInt(form, "departmentId"),
        hireDate: str(form, "hireDate") || undefined,
        grossSalary: moneyOf(form, "grossSalary", context.currency),
        currency: context.currency,
        taxId: optStr(form, "taxId"),
        inpsNumber: optStr(form, "inpsNumber"),
        bankAccount: optStr(form, "bankAccount"),
        phone: optStr(form, "phone"),
        email: optStr(form, "email"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidateHr();
    return id;
  });
}

export async function runPayrollAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "approve");
    const result = createPayrollRun(
      {
        companyId: context.company.id,
        period: str(form, "period", todayISO().slice(0, 7)),
        bankAccountId: int(form, "bankAccountId"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidateHr();
    return result.runId;
  });
}

export async function payPayrollAction(form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "approve");
    const result = payPayrollRun(context.company.id, int(form, "runId"), int(form, "bankAccountId"), {
      userId: context.user.id,
      userName: context.user.name,
    });
    revalidateHr();
    return result.entryId;
  });
}

export async function createAdvanceAction(_prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  const context = await requireContext();
  return attempt(() => {
    requirePermission(context, "approve");
    const result = createAdvance(
      {
        companyId: context.company.id,
        employeeId: int(form, "employeeId"),
        date: dateOf(form, "date", todayISO()),
        amount: moneyOf(form, "amount", context.currency),
        bankAccountId: int(form, "bankAccountId"),
        note: optStr(form, "note"),
      },
      { userId: context.user.id, userName: context.user.name },
    );
    revalidateHr();
    return result.advanceId;
  });
}

export type { ActionState };
