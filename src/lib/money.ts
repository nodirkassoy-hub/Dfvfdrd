/**
 * BUXAI money primitives.
 *
 * Every monetary amount in the database is stored as an INTEGER number of minor
 * units (tiyin / cents). This removes binary floating point drift from the
 * ledger, so debits always equal credits exactly and reports always reconcile
 * to the source transactions.
 */

export type Minor = number; // integer minor units

export const CURRENCIES = ["UZS", "USD", "EUR", "RUB"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const CURRENCY_META: Record<CurrencyCode, { symbol: string; decimals: number; label: string }> = {
  UZS: { symbol: "so'm", decimals: 0, label: "Uzbek so'm" },
  USD: { symbol: "$", decimals: 2, label: "US Dollar" },
  EUR: { symbol: "€", decimals: 2, label: "Euro" },
  RUB: { symbol: "₽", decimals: 2, label: "Russian ruble" },
};

/** Round a decimal amount to the currency's minor unit precision. */
export function roundTo(value: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  const scaled = value * f;
  // Guard against values like 1.005 * 100 = 100.49999999999999
  const rounded = Math.round(scaled + Math.sign(scaled || 1) * 1e-9);
  return rounded / f;
}

export function decimalsFor(currency: string): number {
  return CURRENCY_META[currency as CurrencyCode]?.decimals ?? 2;
}

/** Convert a human decimal amount (12.34) into integer minor units (1234). */
export function toMinor(value: number, currency = "UZS"): Minor {
  const d = decimalsFor(currency);
  return Math.round(roundTo(value, d) * Math.pow(10, d));
}

/** Convert integer minor units back into a human decimal amount. */
export function fromMinor(value: Minor, currency = "UZS"): number {
  const d = decimalsFor(currency);
  return value / Math.pow(10, d);
}

/** Normalise a possibly float-contaminated minor value into a true integer. */
export function normalizeMinor(value: number): Minor {
  return Math.round(value);
}

export type FormatMoneyOptions = {
  currency?: string;
  /** Show the currency code after the number (default: true). */
  showCode?: boolean;
  /** Show +/- sign for positive numbers. */
  signed?: boolean;
  /** Compact notation: 128.5M */
  compact?: boolean;
  /** Always show decimals even for zero-decimal currencies. */
  forceDecimals?: boolean;
  locale?: string;
};

const LOCALE_MAP: Record<string, string> = {
  uz: "en-US", // Uzbek (Latin) grouping follows the continental 1,234,567 convention
  ru: "ru-RU",
  en: "en-US",
};

export function formatMoney(minorValue: Minor, options: FormatMoneyOptions = {}): string {
  const {
    currency = "UZS",
    showCode = true,
    signed = false,
    compact = false,
    forceDecimals = false,
    locale = "en",
  } = options;

  const meta = CURRENCY_META[currency as CurrencyCode] ?? { symbol: currency, decimals: 2, label: currency };
  const decimals = forceDecimals ? Math.max(2, meta.decimals) : meta.decimals;
  const amount = fromMinor(minorValue, currency);
  const abs = Math.abs(amount);

  const intlLocale = LOCALE_MAP[locale] ?? "en-US";
  let body: string;
  if (compact) {
    body = new Intl.NumberFormat(intlLocale, {
      notation: "compact",
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    }).format(abs);
  } else {
    body = new Intl.NumberFormat(intlLocale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(abs);
  }

  const sign = amount < 0 ? "-" : signed ? "+" : "";
  const code = showCode ? ` ${currency}` : "";
  return `${sign}${body}${code}`;
}

/** Format without a currency code — used inside dense tables where the column header carries the unit. */
export function formatAmount(minorValue: Minor, currency = "UZS", locale = "en"): string {
  return formatMoney(minorValue, { currency, showCode: false, locale });
}

export function formatCompactMoney(minorValue: Minor, currency = "UZS", locale = "en"): string {
  return formatMoney(minorValue, { currency, compact: true, showCode: false, locale });
}

/** Parse user input ("1 250 000,50", "$1,250,000", "1250000") into minor units. */
export function parseMoneyInput(input: string | number | null | undefined, currency = "UZS"): Minor {
  if (input === null || input === undefined || input === "") return 0;
  if (typeof input === "number") return toMinor(input, currency);
  const cleaned = input
    .replace(/\s|\u00a0/g, "")
    .replace(/[^\d.,-]/g, "")
    .replace(/,(?=\d{3}\b)/g, "") // thousand separators
    .replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return toMinor(parsed, currency);
}

/** Percentage helper that avoids divide-by-zero. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatPercent(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatPlainPercent(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)}%`;
}

/**
 * Currency conversion using a rate table entry (rate = value of 1 unit of the
 * foreign currency expressed in company currency).
 */
export function convert(minorValue: Minor, rate: number, fromCurrency = "UZS", toCurrency = "UZS"): Minor {
  if (fromCurrency === toCurrency) return normalizeMinor(minorValue);
  const human = fromMinor(minorValue, fromCurrency);
  return toMinor(human * rate, toCurrency);
}
