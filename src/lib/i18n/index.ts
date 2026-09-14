import { DICTIONARIES, DICTIONARY_KEYS } from "./dictionary";
import { DEFAULT_LOCALE, isLocale, type Dict, type Locale } from "./types";

export * from "./types";
export { DICTIONARY_KEYS };

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

const cache = new Map<Locale, Dict>();

function dictFor(locale: Locale): Dict {
  const cached = cache.get(locale);
  if (cached) return cached;
  const dict = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  cache.set(locale, dict);
  return dict;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/**
 * Translate a key. Falls back to English, then to the raw key, so a label can
 * never render as `undefined` in the interface.
 */
export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const dict = dictFor(locale);
  const value = dict[key] ?? DICTIONARIES.en[key] ?? key;
  return interpolate(value, vars);
}

export function createTranslator(locale: Locale): TranslateFn {
  return (key, vars) => translate(locale, key, vars);
}

export function resolveLocale(value: string | undefined | null): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Coverage report — used by the localization smoke test. */
export function dictionaryStats(): { total: number; perLocale: Record<Locale, number> } {
  const perLocale = { uz: 0, ru: 0, en: 0 } as Record<Locale, number>;
  for (const key of DICTIONARY_KEYS) {
    for (const locale of ["uz", "ru", "en"] as Locale[]) {
      if (DICTIONARIES[locale][key]) perLocale[locale] += 1;
    }
  }
  return { total: DICTIONARY_KEYS.length, perLocale };
}
