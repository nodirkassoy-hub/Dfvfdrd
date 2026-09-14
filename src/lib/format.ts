/**
 * Client-safe formatting helpers.
 *
 * The same numbers appear in server components and client components; these
 * helpers guarantee identical rendering in both by using the currency metadata
 * from `lib/money.ts`.
 */
import { CURRENCY_META, formatMoney, type CurrencyCode } from "./money";
import type { Locale } from "./i18n/types";

export function money(minor: number, currency = "UZS", locale: Locale = "en", options: { signed?: boolean; compact?: boolean; code?: boolean } = {}): string {
  return formatMoney(minor, {
    currency,
    showCode: options.code ?? true,
    signed: options.signed,
    compact: options.compact,
    locale: locale === "ru" ? "ru" : "en",
  });
}

export function amount(minor: number, currency = "UZS", locale: Locale = "en"): string {
  return formatMoney(minor, { currency, showCode: false, locale: locale === "ru" ? "ru" : "en" });
}

export function compactMoney(minor: number, currency = "UZS", locale: Locale = "en"): string {
  return formatMoney(minor, { currency, showCode: false, compact: true, locale: locale === "ru" ? "ru" : "en" });
}

export function compactScale(minor: number, currency = "UZS", locale: Locale = "en"): string {
  const meta = CURRENCY_META[currency as CurrencyCode] ?? { decimals: 2 };
  const human = minor / Math.pow(10, meta.decimals);
  const abs = Math.abs(human);
  const symbol = locale === "ru" ? "млн" : "M";
  if (abs >= 1_000_000_000) return `${(human / 1_000_000_000).toFixed(1)} ${locale === "ru" ? "млрд" : "B"}`;
  if (abs >= 1_000_000) return `${(human / 1_000_000).toFixed(1)} ${symbol}`;
  if (abs >= 1_000) return `${(human / 1_000).toFixed(0)}K`;
  return human.toFixed(0);
}

export function percent(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

export function plainPercent(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)}%`;
}

export function qty(qtyMilli: number, locale: Locale = "en"): string {
  const value = qtyMilli / 1000;
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: 3 }).format(value);
}

export function hoursAgo(iso: string, locale: Locale = "en"): string {
  const diff = Date.now() - Date.parse(iso);
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return locale === "ru" ? "только что" : locale === "uz" ? "hozir" : "just now";
  if (minutes < 60) return locale === "ru" ? `${minutes} мин назад` : locale === "uz" ? `${minutes} daqiqa oldin` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return locale === "ru" ? `${hours} ч назад` : locale === "uz" ? `${hours} soat oldin` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return locale === "ru" ? `${days} дн назад` : locale === "uz" ? `${days} kun oldin` : `${days}d ago`;
}
