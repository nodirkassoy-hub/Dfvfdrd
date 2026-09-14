import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getTheme } from "@/lib/auth/guard";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/types";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "BUXAI — Financial operating system for business",
  description:
    "BUXAI is a business accounting and financial management platform: double-entry ledger, invoicing, banking, inventory, payroll, tax, reporting and an AI finance centre built on real ledger data.",
  applicationName: "BUXAI",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4338ca",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const localeCookie = store.get("buxai_locale")?.value;
  const locale: Locale = localeCookie === "ru" || localeCookie === "en" ? localeCookie : DEFAULT_LOCALE;
  const theme = await getTheme().catch(() => "light" as const);

  return (
    <html lang={locale} data-theme={theme} suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
