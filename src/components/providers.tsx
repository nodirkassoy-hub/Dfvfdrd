"use client";

import * as React from "react";
import { ToastProvider } from "@/components/ui/primitives";
import { createTranslator, type Locale, type TranslateFn } from "@/lib/i18n";
import type { CurrencyCode } from "@/lib/money";

type AppContextValue = {
  locale: Locale;
  t: TranslateFn;
  currency: string;
  companyId: number;
  companyName: string;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: "light" | "dark") => void;
  theme: "light" | "dark";
};

const AppContext = React.createContext<AppContextValue | null>(null);

export function AppProvider({
  locale: initialLocale,
  currency,
  companyId,
  companyName,
  theme: initialTheme,
  children,
}: {
  locale: Locale;
  currency: string;
  companyId: number;
  companyName: string;
  theme: "light" | "dark";
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);
  const [theme, setThemeState] = React.useState<"light" | "dark">(initialTheme);

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `buxai_locale=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    window.location.reload();
  }, []);

  const setTheme = React.useCallback((next: "light" | "dark") => {
    setThemeState(next);
    document.cookie = `buxai_theme=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const value = React.useMemo<AppContextValue>(
    () => ({
      locale,
      t: createTranslator(locale),
      currency,
      companyId,
      companyName,
      setLocale,
      setTheme,
      theme,
    }),
    [locale, currency, companyId, companyName, setLocale, setTheme, theme],
  );

  return (
    <AppContext.Provider value={value}>
      <ToastProvider>{children}</ToastProvider>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const context = React.useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used inside AppProvider");
  }
  return context;
}

export function useT(): TranslateFn {
  return useApp().t;
}

export function useCurrency(): string {
  return useApp().currency;
}

export type { CurrencyCode };
