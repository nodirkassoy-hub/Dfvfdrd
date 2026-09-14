import { AccountingError, ValidationError } from "@/lib/accounting/errors";
import { parseMoneyInput } from "@/lib/money";
import { todayISO } from "@/lib/dates";

export type ActionState = {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
  data?: unknown;
};

export function str(form: FormData, key: string, fallback = ""): string {
  const value = form.get(key);
  if (value === null) return fallback;
  return String(value).trim();
}

export function optStr(form: FormData, key: string): string | undefined {
  const value = str(form, key);
  return value === "" ? undefined : value;
}

export function bool(form: FormData, key: string, fallback = false): boolean {
  const value = form.get(key);
  if (value === null) return fallback;
  const normalized = String(value).toLowerCase();
  return ["1", "true", "on", "yes"].includes(normalized);
}

export function int(form: FormData, key: string, fallback = 0): number {
  const value = Number(String(form.get(key) ?? "").replace(/[^\d-]/g, ""));
  return Number.isFinite(value) ? value : fallback;
}

export function optInt(form: FormData, key: string): number | null {
  const raw = str(form, key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function moneyOf(form: FormData, key: string, currency = "UZS"): number {
  return parseMoneyInput(str(form, key), currency);
}

export function dateOf(form: FormData, key: string, fallback?: string): string {
  const value = str(form, key);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{2}[./]\d{2}[./]\d{4}$/.test(value)) {
    const [day, month, year] = value.split(/[./]/);
    return `${year}-${month}-${day}`;
  }
  return fallback ?? todayISO();
}

export function qtyMilliOf(form: FormData, key: string): number {
  const raw = str(form, key).replace(/\s/g, "").replace(",", ".");
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? Math.round(value * 1000) : 0;
}

/** Runs a mutation and converts domain errors into a UI-ready result. */
export async function attempt<T>(fn: () => Promise<T> | T): Promise<ActionState> {
  try {
    const result = await fn();
    const id = typeof result === "number" ? result : undefined;
    return { ok: true, id, data: result as unknown };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, error: error.message };
    }
    if (error instanceof AccountingError) {
      return { ok: false, error: error.message };
    }
    if (error instanceof Error) {
      if (error.message.startsWith("FORBIDDEN:")) {
        const permission = error.message.split(":")[1];
        return { ok: false, error: `Your role does not allow this action (${permission}).` };
      }
      if (error.message.startsWith("CLOSE_BLOCKED:")) {
        return { ok: false, error: error.message.replace("CLOSE_BLOCKED:", "").trim() };
      }
      if (process.env.NODE_ENV !== "production") {
        console.error("[buxai action]", error);
      }
      return { ok: false, error: error.message || "The action could not be completed. Nothing was changed — please retry." };
    }
    return { ok: false, error: "The action could not be completed. Nothing was changed — please retry." };
  }
}

/** Parses the invoice/bill line items that the client form serialises as JSON. */
export type ParsedLine = {
  productId: number | null;
  description: string;
  qtyMilli: number;
  unitPrice: number;
  discount: number;
  taxRateBp: number;
  accountId: number | null;
  taxCodeId: number | null;
  warehouseId: number | null;
};

export function parseLines(form: FormData, currency = "UZS"): ParsedLine[] {
  const raw = str(form, "lines");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((line) => {
        const item = line as Record<string, unknown>;
        return {
          productId: item.productId ? Number(item.productId) : null,
          description: String(item.description ?? "").trim() || "Item",
          qtyMilli: Math.max(0, Math.round(Number(item.qty ?? 0) * 1000)),
          unitPrice: Math.round(Number(item.unitPrice ?? 0)),
          discount: Math.max(0, Math.round(Number(item.discount ?? 0))),
          taxRateBp: Math.max(0, Math.round(Number(item.taxRateBp ?? 0))),
          accountId: item.accountId ? Number(item.accountId) : null,
          taxCodeId: item.taxCodeId ? Number(item.taxCodeId) : null,
          warehouseId: item.warehouseId ? Number(item.warehouseId) : null,
        } satisfies ParsedLine;
      })
      .filter((line) => line.description && line.qtyMilli > 0);
  } catch {
    void currency;
    return [];
  }
}
