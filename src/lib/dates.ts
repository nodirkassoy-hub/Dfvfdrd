/**
 * BUXAI date utilities.
 *
 * All accounting dates are stored as calendar dates in ISO form (YYYY-MM-DD)
 * and all arithmetic is performed on those calendar parts. This keeps period
 * boundaries (month / quarter / fiscal year) exact regardless of server or
 * browser timezone — a hard requirement for reproducible financial reports.
 */

import type { Locale } from "./i18n/types";

const MS_DAY = 86_400_000;

export function toISO(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export function todayISO(): string {
  const now = new Date();
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function parseISO(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { year: y, month: m, day: d };
}

export function isValidISO(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function utc(iso: string): number {
  const { year, month, day } = parseISO(iso);
  return Date.UTC(year, month - 1, day);
}

export function diffDays(fromISO: string, toISOStr: string): number {
  return Math.round((utc(toISOStr) - utc(fromISO)) / MS_DAY);
}

export function addDays(iso: string, days: number): string {
  const { year, month, day } = parseISO(iso);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonths(iso: string, months: number): string {
  const { year, month, day } = parseISO(iso);
  const total = (year * 12 + (month - 1)) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return toISO(y, m, Math.min(day, daysInMonth(y, m)));
}

export function addYears(iso: string, years: number): string {
  return addMonths(iso, years * 12);
}

export function startOfMonth(iso: string): string {
  const { year, month } = parseISO(iso);
  return toISO(year, month, 1);
}

export function endOfMonth(iso: string): string {
  const { year, month } = parseISO(iso);
  return toISO(year, month, daysInMonth(year, month));
}

export function startOfQuarter(iso: string): string {
  const { year, month } = parseISO(iso);
  const qStart = Math.floor((month - 1) / 3) * 3 + 1;
  return toISO(year, qStart, 1);
}

export function endOfQuarter(iso: string): string {
  return endOfMonth(addMonths(startOfQuarter(iso), 2));
}

export function startOfYear(iso: string): string {
  return toISO(parseISO(iso).year, 1, 1);
}

export function endOfYear(iso: string): string {
  return toISO(parseISO(iso).year, 12, 31);
}

/** ISO week-independent month bucket key: 2026-09 */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthKeyAdd(key: string, months: number): string {
  return monthKey(addMonths(`${key}-01`, months));
}

/** Inclusive list of month keys between two dates. */
export function monthRange(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  let cursor = startOfMonth(startISO);
  const last = startOfMonth(endISO);
  let guard = 0;
  while (cursor <= last && guard < 600) {
    out.push(monthKey(cursor));
    cursor = addMonths(cursor, 1);
    guard += 1;
  }
  return out;
}

export function isBetween(iso: string, from: string, to: string): boolean {
  return iso >= from && iso <= to;
}

export function clampISO(iso: string, from: string, to: string): string {
  if (iso < from) return from;
  if (iso > to) return to;
  return iso;
}

export function maxISO(a: string, b: string): string {
  return a > b ? a : b;
}

export function minISO(a: string, b: string): string {
  return a < b ? a : b;
}

export function ageInDays(iso: string, reference = todayISO()): number {
  return diffDays(iso, reference);
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_UZ = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];
const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_FULL_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_FULL_UZ = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
];
const MONTHS_FULL_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

function monthNames(locale: Locale, full = false): string[] {
  if (locale === "ru") return full ? MONTHS_FULL_RU : MONTHS_RU;
  if (locale === "uz") return full ? MONTHS_FULL_UZ : MONTHS_UZ;
  return full ? MONTHS_FULL_EN : MONTHS_EN;
}

/** 14.09.2026 — unambiguous numeric format used across the product. */
export function formatDate(iso: string | null | undefined, _locale: Locale = "en"): string {
  if (!iso) return "—";
  const { year, month, day } = parseISO(iso);
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
}

/** 14 Sep 2026 — used in headings and cards. */
export function formatDateMedium(iso: string | null | undefined, locale: Locale = "en"): string {
  if (!iso) return "—";
  const { year, month, day } = parseISO(iso);
  return `${day} ${monthNames(locale)[month - 1]} ${year}`;
}

export function formatMonthLabel(key: string, locale: Locale = "en", full = false): string {
  const [y, m] = key.split("-").map(Number);
  return `${monthNames(locale, full)[(m ?? 1) - 1]} ${y}`;
}

export function formatMonthShort(key: string, locale: Locale = "en"): string {
  const [, m] = key.split("-").map(Number);
  return monthNames(locale)[(m ?? 1) - 1];
}

export type PeriodPreset =
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "this_year"
  | "last_year"
  | "ytd"
  | "last_30_days"
  | "last_90_days"
  | "all_time"
  | "custom";

export const PERIOD_PRESETS: PeriodPreset[] = [
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "ytd",
  "this_year",
  "last_year",
  "last_30_days",
  "last_90_days",
  "all_time",
];

export type Period = {
  preset: PeriodPreset;
  from: string;
  to: string;
  key: string; // human label
  previousFrom: string;
  previousTo: string;
  previousKey: string;
};

/** Resolve a preset into concrete date ranges, including the comparison period. */
export function resolvePeriod(
  preset: PeriodPreset,
  opts: { today?: string; from?: string; to?: string; firstDataDate?: string; locale?: Locale } = {},
): Period {
  const today = opts.today ?? todayISO();
  const locale = opts.locale ?? "en";
  const first = opts.firstDataDate ?? startOfYear(addYears(today, -3));

  const build = (from: string, to: string, label: string): Period => {
    const span = Math.max(1, diffDays(from, to));
    const previousTo = addDays(from, -1);
    const previousFrom = addDays(previousTo, -span);
    return {
      preset,
      from,
      to,
      key: label,
      previousFrom,
      previousTo,
      previousKey: `${formatDate(previousFrom, locale)} – ${formatDate(previousTo, locale)}`,
    };
  };

  switch (preset) {
    case "this_month":
      return build(startOfMonth(today), endOfMonth(today), formatMonthLabel(monthKey(today), locale, true));
    case "last_month": {
      const ref = addMonths(today, -1);
      return build(startOfMonth(ref), endOfMonth(ref), formatMonthLabel(monthKey(ref), locale, true));
    }
    case "this_quarter":
      return build(startOfQuarter(today), endOfQuarter(today), quarterLabel(today));
    case "last_quarter": {
      const ref = addMonths(startOfQuarter(today), -1);
      return build(startOfQuarter(ref), endOfQuarter(ref), quarterLabel(ref));
    }
    case "ytd":
      return build(startOfYear(today), today, `${formatDate(startOfYear(today), locale)} – ${formatDate(today, locale)}`);
    case "this_year":
      return build(startOfYear(today), endOfYear(today), String(parseISO(today).year));
    case "last_year": {
      const ref = addYears(today, -1);
      return build(startOfYear(ref), endOfYear(ref), String(parseISO(ref).year));
    }
    case "last_30_days":
      return build(addDays(today, -29), today, `${formatDate(addDays(today, -29), locale)} – ${formatDate(today, locale)}`);
    case "last_90_days":
      return build(addDays(today, -89), today, `${formatDate(addDays(today, -89), locale)} – ${formatDate(today, locale)}`);
    case "all_time":
      return build(first, endOfMonth(addMonths(today, 6)), `${formatDate(first, locale)} – ${formatDate(today, locale)}`);
    case "custom":
    default: {
      const from = opts.from ?? startOfMonth(today);
      const to = opts.to ?? today;
      return build(minISO(from, to), maxISO(from, to), `${formatDate(from, locale)} – ${formatDate(to, locale)}`);
    }
  }
}

export function quarterLabel(iso: string): string {
  const { year, month } = parseISO(iso);
  return `Q${Math.floor((month - 1) / 3) + 1} ${year}`;
}

/** Aging buckets used by receivables / payables analysis. */
export type AgingBucket = "current" | "1_30" | "31_60" | "61_90" | "90_plus";

export function agingBucket(dueDate: string, reference = todayISO()): AgingBucket {
  const overdueDays = diffDays(dueDate, reference);
  if (overdueDays <= 0) return "current";
  if (overdueDays <= 30) return "1_30";
  if (overdueDays <= 60) return "31_60";
  if (overdueDays <= 90) return "61_90";
  return "90_plus";
}
