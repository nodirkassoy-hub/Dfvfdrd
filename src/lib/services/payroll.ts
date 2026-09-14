/**
 * Payroll: employees, advances, monthly runs.
 *
 * A run posts one balanced entry:
 *   Dr Salaries & wages (6010)        gross
 *   Dr Social contribution (6020)     employer social
 *   Cr Payroll payable (2020)         gross − income tax − advances deducted
 *   Cr Payroll income tax (2033)      income tax
 *   Cr Social payable (2034)          employer social
 *   Cr Advances to employees (1103)   advances deducted this month
 */
import { all, insert, nowISO, one, run, tx } from "@/lib/db";
import { ValidationError } from "@/lib/accounting/errors";
import { SYSTEM_ACCOUNTS } from "@/lib/accounting/coa";
import { accountIdByCodeOrThrow, postEntryTx } from "@/lib/accounting/engine";
import { monthRange } from "@/lib/dates";
import { recordAudit } from "./company";

export type Ctx = { userId?: number | null; userName?: string | null };

export type EmployeeInput = {
  companyId: number;
  fullName: string;
  position?: string;
  departmentId?: number | null;
  hireDate?: string;
  grossSalary: number;
  currency?: string;
  taxId?: string;
  inpsNumber?: string;
  bankAccount?: string;
  phone?: string;
  email?: string;
};

export function createEmployee(input: EmployeeInput, ctx: Ctx = {}): number {
  if (!input.fullName?.trim()) throw new ValidationError("NAME_REQUIRED", "Employee name is required");
  return tx(() => {
    const stamp = nowISO();
    const id = insert(
      `INSERT INTO employees (company_id, full_name, position, department_id, hire_date, gross_salary, currency, tax_id,
        inps_number, bank_account, phone, email, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        input.companyId,
        input.fullName.trim(),
        input.position ?? null,
        input.departmentId ?? null,
        input.hireDate ?? null,
        Math.round(input.grossSalary),
        input.currency ?? "UZS",
        input.taxId ?? null,
        input.inpsNumber ?? null,
        input.bankAccount ?? null,
        input.phone ?? null,
        input.email ?? null,
        stamp,
        stamp,
      ],
    );
    recordAudit({
      companyId: input.companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "create",
      entityType: "employee",
      entityId: id,
      summary: `Added employee ${input.fullName}`,
      after: { grossSalary: input.grossSalary, position: input.position ?? null },
    });
    return id;
  });
}

export function updateEmployee(companyId: number, employeeId: number, patch: Partial<EmployeeInput> & { status?: string; endDate?: string }, ctx: Ctx = {}): void {
  const map: [string, string][] = [
    ["fullName", "full_name"],
    ["position", "position"],
    ["departmentId", "department_id"],
    ["hireDate", "hire_date"],
    ["endDate", "end_date"],
    ["grossSalary", "gross_salary"],
    ["currency", "currency"],
    ["taxId", "tax_id"],
    ["inpsNumber", "inps_number"],
    ["bankAccount", "bank_account"],
    ["phone", "phone"],
    ["email", "email"],
    ["status", "status"],
  ];
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of map) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(value);
  }
  if (!fields.length) return;
  values.push(nowISO(), companyId, employeeId);
  run(`UPDATE employees SET ${fields.join(", ")}, updated_at = ? WHERE company_id = ? AND id = ?`, values);
  recordAudit({
    companyId,
    userId: ctx.userId,
    userName: ctx.userName,
    action: "update",
    entityType: "employee",
    entityId: employeeId,
    summary: "Employee record updated",
    after: patch,
  });
}

export function listEmployees(companyId: number, includeArchived = false) {
  return all<{
    id: number;
    fullName: string;
    position: string | null;
    departmentId: number | null;
    departmentName: string | null;
    hireDate: string | null;
    grossSalary: number;
    currency: string;
    taxId: string | null;
    bankAccount: string | null;
    phone: string | null;
    email: string | null;
    status: string;
    advanceBalance: number;
    netEstimate: number;
  }>(
    `SELECT e.id, e.full_name AS fullName, e.position, e.department_id AS departmentId, d.name AS departmentName,
            e.hire_date AS hireDate, e.gross_salary AS grossSalary, e.currency, e.tax_id AS taxId,
            e.bank_account AS bankAccount, e.phone, e.email, e.status,
            COALESCE((SELECT SUM(a.amount) FROM employee_advances a WHERE a.employee_id = e.id AND a.deducted_in_run IS NULL), 0) AS advanceBalance,
            0 AS netEstimate
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.company_id = ? ${includeArchived ? "" : "AND e.status = 'active'"}
      ORDER BY e.full_name`,
    [companyId],
  ).map((row) => {
    const company = one<{ payroll_income_bp: number }>("SELECT payroll_income_bp FROM companies WHERE id = ?", [companyId]);
    const rate = company?.payroll_income_bp ?? 1200;
    const tax = Math.round((row.grossSalary * rate) / 10_000);
    return { ...row, netEstimate: row.grossSalary - tax };
  });
}

export function createAdvance(
  input: { companyId: number; employeeId: number; date: string; amount: number; bankAccountId: number; note?: string },
  ctx: Ctx = {},
): { advanceId: number; entryId: number } {
  if (input.amount <= 0) throw new ValidationError("AMOUNT_ZERO", "Advance amount must be greater than zero");
  return tx(() => {
    const employee = one<{ id: number; full_name: string }>("SELECT id, full_name FROM employees WHERE id = ? AND company_id = ?", [
      input.employeeId,
      input.companyId,
    ]);
    if (!employee) throw new ValidationError("NOT_FOUND", "Employee not found");
    const bank = one<{ account_id: number }>("SELECT account_id FROM bank_accounts WHERE id = ? AND company_id = ?", [
      input.bankAccountId,
      input.companyId,
    ]);
    if (!bank) throw new ValidationError("ACCOUNT_NOT_FOUND", "Payment account not found");

    const entry = postEntryTx({
      companyId: input.companyId,
      date: input.date,
      memo: `Advance to ${employee.full_name}`,
      sourceType: "payroll",
      userId: ctx.userId ?? null,
      lines: [
        {
          accountId: accountIdByCodeOrThrow(input.companyId, SYSTEM_ACCOUNTS.EMPLOYEE_ADVANCES),
          debit: input.amount,
          description: `Advance — ${employee.full_name}`,
          contactType: "employee",
          contactId: employee.id,
        },
        { accountId: bank.account_id, credit: input.amount, description: `Advance paid to ${employee.full_name}` },
      ],
    });

    const advanceId = insert(
      `INSERT INTO employee_advances (company_id, employee_id, date, amount, currency, payment_account_id, journal_entry_id,
        note, created_by, created_at)
       VALUES (?, ?, ?, ?, 'UZS', ?, ?, ?, ?, ?)`,
      [input.companyId, input.employeeId, input.date, input.amount, input.bankAccountId, entry.id, input.note ?? null, ctx.userId ?? null, nowISO()],
    );
    recordAudit({
      companyId: input.companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "create",
      entityType: "advance",
      entityId: advanceId,
      summary: `Advance of ${input.amount} to ${employee.full_name}`,
      after: { entryId: entry.id },
    });
    return { advanceId, entryId: entry.id };
  });
}

export function listAdvances(companyId: number, includeDeducted = false) {
  return all<{
    id: number;
    employeeId: number;
    employeeName: string;
    date: string;
    amount: number;
    deductedInRun: number | null;
    deductedPeriod: string | null;
    journalEntryId: number | null;
    note: string | null;
  }>(
    `SELECT a.id, a.employee_id AS employeeId, e.full_name AS employeeName, a.date, a.amount,
            a.deducted_in_run AS deductedInRun, p.period AS deductedPeriod, a.journal_entry_id AS journalEntryId, a.note
       FROM employee_advances a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN payroll_runs p ON p.id = a.deducted_in_run
      WHERE a.company_id = ? ${includeDeducted ? "" : "AND a.deducted_in_run IS NULL"}
      ORDER BY a.date DESC`,
    [companyId],
  );
}

export type PayrollRunInput = {
  companyId: number;
  period: string; // YYYY-MM
  bankAccountId: number;
  bonuses?: Record<number, number>;
};

export function createPayrollRun(input: PayrollRunInput, ctx: Ctx = {}): { runId: number; entryId: number } {
  return tx(() => {
    const existing = one<{ id: number }>("SELECT id FROM payroll_runs WHERE company_id = ? AND period = ?", [input.companyId, input.period]);
    if (existing) throw new ValidationError("RUN_EXISTS", "Payroll for this period has already been calculated");

    const company = one<{ payroll_income_bp: number; social_rate_bp: number }>(
      "SELECT payroll_income_bp, social_rate_bp FROM companies WHERE id = ?",
      [input.companyId],
    );
    const incomeRate = company?.payroll_income_bp ?? 1200;
    const socialRate = company?.social_rate_bp ?? 1200;

    const employees = all<{ id: number; full_name: string; gross_salary: number }>(
      "SELECT id, full_name, gross_salary FROM employees WHERE company_id = ? AND status = 'active' ORDER BY full_name",
      [input.companyId],
    );
    if (!employees.length) throw new ValidationError("NO_EMPLOYEES", "Add employees before running payroll");

    const monthEnd = `${input.period}-28`.slice(0, 10);
    const payDate = `${input.period}-28`;
    const runId = insert(
      `INSERT INTO payroll_runs (company_id, period, status, account_id, created_by, created_at)
       VALUES (?, ?, 'draft', ?, ?, ?)`,
      [input.companyId, input.period, input.bankAccountId, ctx.userId ?? null, nowISO()],
    );

    let grossTotal = 0;
    let taxTotal = 0;
    let socialTotal = 0;
    let netTotal = 0;
    let advanceTotal = 0;
    const lines: { accountId: number; debit?: number; credit?: number; description: string; contactType?: "employee"; contactId?: number }[] = [];

    for (const employee of employees) {
      const bonus = Math.round(input.bonuses?.[employee.id] ?? 0);
      const gross = employee.gross_salary + bonus;
      const incomeTax = Math.round((gross * incomeRate) / 10_000);
      const social = Math.round((gross * socialRate) / 10_000);
      const advances = all<{ id: number; amount: number }>(
        "SELECT id, amount FROM employee_advances WHERE employee_id = ? AND deducted_in_run IS NULL",
        [employee.id],
      );
      const advCandidate = advances.reduce((sum, advance) => sum + advance.amount, 0);
      const netBeforeAdvances = gross - incomeTax;
      const advanceDeduction = Math.min(advCandidate, Math.max(0, netBeforeAdvances));
      const net = netBeforeAdvances - advanceDeduction;

      insert(
        `INSERT INTO payroll_lines (payroll_run_id, employee_id, gross, bonus, income_tax, social, other_deduction,
          advance_deduction, net)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [runId, employee.id, gross, bonus, incomeTax, social, advanceDeduction, net],
      );

      grossTotal += gross;
      taxTotal += incomeTax;
      socialTotal += social;
      netTotal += net;
      advanceTotal += advanceDeduction;

      if (advanceDeduction > 0) {
        run(
          `UPDATE employee_advances SET deducted_in_run = ? WHERE employee_id = ? AND deducted_in_run IS NULL`,
          [runId, employee.id],
        );
      }
      void monthEnd;
      void payDate;
    }

    const entry = postEntryTx({
      companyId: input.companyId,
      date: `${input.period}-28`,
      memo: `Payroll ${input.period}`,
      reference: `PR-${input.period}`,
      sourceType: "payroll",
      sourceId: runId,
      userId: ctx.userId ?? null,
      lines: [
        { accountId: accountIdByCodeOrThrow(input.companyId, SYSTEM_ACCOUNTS.SALARY_EXPENSE), debit: grossTotal, description: `Salaries ${input.period}` },
        ...(socialTotal > 0
          ? [{ accountId: accountIdByCodeOrThrow(input.companyId, SYSTEM_ACCOUNTS.SOCIAL_EXPENSE), debit: socialTotal, description: `Social contribution ${input.period}` }]
          : []),
        { accountId: accountIdByCodeOrThrow(input.companyId, SYSTEM_ACCOUNTS.PAYROLL_PAYABLE), credit: netTotal, description: `Net salaries payable ${input.period}` },
        ...(taxTotal > 0
          ? [{ accountId: accountIdByCodeOrThrow(input.companyId, SYSTEM_ACCOUNTS.PAYROLL_TAX_PAYABLE), credit: taxTotal, description: `Income tax withheld ${input.period}` }]
          : []),
        ...(socialTotal > 0
          ? [{ accountId: accountIdByCodeOrThrow(input.companyId, SYSTEM_ACCOUNTS.SOCIAL_PAYABLE), credit: socialTotal, description: `Social contribution payable ${input.period}` }]
          : []),
        ...(advanceTotal > 0
          ? [{ accountId: accountIdByCodeOrThrow(input.companyId, SYSTEM_ACCOUNTS.EMPLOYEE_ADVANCES), credit: advanceTotal, description: `Advances deducted ${input.period}` }]
          : []),
      ],
    });
    void lines;

    run(
      `UPDATE payroll_runs SET status = 'approved', gross_total = ?, tax_total = ?, social_total = ?, deduction_total = ?,
        net_total = ?, journal_entry_id = ?, approved_by = ?, approved_at = ? WHERE id = ?`,
      [grossTotal, taxTotal, socialTotal, advanceTotal, netTotal, entry.id, ctx.userId ?? null, nowISO(), runId],
    );

    recordAudit({
      companyId: input.companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "post",
      entityType: "payroll",
      entityId: runId,
      summary: `Payroll ${input.period}: gross ${grossTotal}, net ${netTotal}, entries ${entry.number}`,
      after: { grossTotal, netTotal, taxTotal, socialTotal, advanceTotal, entryId: entry.id },
    });

    return { runId, entryId: entry.id };
  });
}

export function payPayrollRun(companyId: number, runId: number, bankAccountId: number, ctx: Ctx = {}): { entryId: number } {
  return tx(() => {
    const runRow = one<{ period: string; net_total: number; status: string; journal_entry_id: number | null }>(
      "SELECT period, net_total, status, journal_entry_id FROM payroll_runs WHERE id = ? AND company_id = ?",
      [runId, companyId],
    );
    if (!runRow) throw new ValidationError("NOT_FOUND", "Payroll run not found");
    if (runRow.status === "paid") throw new ValidationError("ALREADY_PAID", "This payroll run has already been paid");
    if (runRow.net_total <= 0) throw new ValidationError("ZERO_TOTAL", "Nothing to pay");

    const bank = one<{ account_id: number }>("SELECT account_id FROM bank_accounts WHERE id = ? AND company_id = ?", [bankAccountId, companyId]);
    if (!bank) throw new ValidationError("ACCOUNT_NOT_FOUND", "Payment account not found");

    const entry = postEntryTx({
      companyId,
      date: new Date().toISOString().slice(0, 10),
      memo: `Salary payment ${runRow.period}`,
      sourceType: "payroll",
      sourceId: runId,
      userId: ctx.userId ?? null,
      lines: [
        { accountId: accountIdByCodeOrThrow(companyId, SYSTEM_ACCOUNTS.PAYROLL_PAYABLE), debit: runRow.net_total, description: `Salaries paid ${runRow.period}` },
        { accountId: bank.account_id, credit: runRow.net_total, description: `Payroll transfer ${runRow.period}` },
      ],
    });

    run("UPDATE payroll_runs SET status = 'paid', account_id = ? WHERE id = ?", [bankAccountId, runId]);
    recordAudit({
      companyId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: "payment",
      entityType: "payroll",
      entityId: runId,
      summary: `Paid payroll ${runRow.period} (${runRow.net_total})`,
      after: { entryId: entry.id },
    });
    return { entryId: entry.id };
  });
}

export function listPayrollRuns(companyId: number) {
  return all<{
    id: number;
    period: string;
    status: string;
    grossTotal: number;
    taxTotal: number;
    socialTotal: number;
    deductionTotal: number;
    netTotal: number;
    journalEntryId: number | null;
    entryNumber: string | null;
    employees: number;
    approvedAt: string | null;
  }>(
    `SELECT r.id, r.period, r.status, r.gross_total AS grossTotal, r.tax_total AS taxTotal, r.social_total AS socialTotal,
            r.deduction_total AS deductionTotal, r.net_total AS netTotal, r.journal_entry_id AS journalEntryId,
            e.number AS entryNumber, r.approved_at AS approvedAt,
            (SELECT COUNT(*) FROM payroll_lines l WHERE l.payroll_run_id = r.id) AS employees
       FROM payroll_runs r LEFT JOIN journal_entries e ON e.id = r.journal_entry_id
      WHERE r.company_id = ? ORDER BY r.period DESC`,
    [companyId],
  );
}

export function payrollRunDetail(companyId: number, runId: number) {
  const run = one<Record<string, unknown>>(
    `SELECT r.*, e.number AS entryNumber FROM payroll_runs r LEFT JOIN journal_entries e ON e.id = r.journal_entry_id
      WHERE r.id = ? AND r.company_id = ?`,
    [runId, companyId],
  );
  if (!run) return undefined;
  const lines = all<{
    id: number;
    employeeName: string;
    position: string | null;
    gross: number;
    bonus: number;
    incomeTax: number;
    social: number;
    advanceDeduction: number;
    net: number;
  }>(
    `SELECT l.id, e.full_name AS employeeName, e.position, l.gross, l.bonus, l.income_tax AS incomeTax, l.social,
            l.advance_deduction AS advanceDeduction, l.net
       FROM payroll_lines l JOIN employees e ON e.id = l.employee_id
      WHERE l.payroll_run_id = ? ORDER BY e.full_name`,
    [runId],
  );
  return { run, lines };
}

export function payrollOverview(companyId: number) {
  const headcount = one<{ count: number; gross: number }>(
    "SELECT COUNT(*) AS count, COALESCE(SUM(gross_salary),0) AS gross FROM employees WHERE company_id = ? AND status = 'active'",
    [companyId],
  );
  const lastRun = one<{ period: string; net_total: number; gross_total: number; status: string }>(
    "SELECT period, net_total, gross_total, status FROM payroll_runs WHERE company_id = ? ORDER BY period DESC LIMIT 1",
    [companyId],
  );
  const recentPeriods = monthRange(
    new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10),
    new Date().toISOString().slice(0, 10),
  );
  return { headcount: headcount?.count ?? 0, monthlyGross: headcount?.gross ?? 0, lastRun, recentPeriods };
}
