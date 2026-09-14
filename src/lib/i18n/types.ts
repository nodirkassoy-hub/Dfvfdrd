export const LOCALES = ["uz", "ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export type Dict = Record<string, string>;

export const LOCALE_META: Record<Locale, { label: string; short: string; flag: string }> = {
  uz: { label: "O'zbekcha", short: "UZ", flag: "🇺🇿" },
  ru: { label: "Русский", short: "RU", flag: "🇷🇺" },
  en: { label: "English", short: "EN", flag: "🇬🇧" },
};

export const DEFAULT_LOCALE: Locale = "uz";
export const LOCALE_COOKIE = "buxai_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
