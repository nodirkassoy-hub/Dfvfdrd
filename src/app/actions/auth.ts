"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { all, insert, nowISO, one, run } from "@/lib/db";
import { createCompany } from "@/lib/services/company";
import { createSession, clearSession, hashPassword, setSessionCookie, verifyPassword } from "@/lib/auth/session";
import { COMPANY_COOKIE } from "@/lib/auth/guard";
import { LOCALE_COOKIE } from "@/lib/i18n/types";

export type ActionState = { ok: boolean; error?: string; message?: string };

function normalizeEmail(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim().toLowerCase();
}

async function startSession(userId: number, companyId: number | null, locale = "uz"): Promise<void> {
  const { token, expiresAt } = createSession(userId);
  await setSessionCookie(token, expiresAt);
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 31_536_000 });
  if (companyId) store.set(COMPANY_COOKIE, String(companyId), { path: "/", sameSite: "lax", maxAge: 31_536_000 });
  run("UPDATE users SET last_login_at = ? WHERE id = ?", [nowISO(), userId]);
}

export async function signInAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { ok: false, error: "Enter your email and password." };

  const user = one<{ id: number; password_hash: string; password_salt: string; locale: string }>(
    "SELECT id, password_hash, password_salt, locale FROM users WHERE email = ?",
    [email],
  );
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return { ok: false, error: "Incorrect email or password." };
  }
  const membership = one<{ company_id: number }>(
    "SELECT company_id FROM company_members WHERE user_id = ? AND status = 'active' ORDER BY id LIMIT 1",
    [user.id],
  );
  await startSession(user.id, membership?.company_id ?? null, user.locale);
  redirect("/dashboard");
}

export async function signUpAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  const companyName = String(formData.get("companyName") ?? "").trim();
  const currency = String(formData.get("currency") ?? "UZS");
  const locale = (String(formData.get("locale") ?? "uz") as "uz" | "ru" | "en") ?? "uz";

  if (name.length < 2) return { ok: false, error: "Enter your full name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  if (companyName.length < 2) return { ok: false, error: "Enter your company name." };

  const existing = one<{ id: number }>("SELECT id FROM users WHERE email = ?", [email]);
  if (existing) return { ok: false, error: "An account with this email already exists." };

  const { hash, salt } = hashPassword(password);
  const userId = insert(
    "INSERT INTO users (email, name, password_hash, password_salt, locale, theme, created_at) VALUES (?, ?, ?, ?, ?, 'light', ?)",
    [email, name, hash, salt, locale, nowISO()],
  );
  const companyId = createCompany({
    name: companyName,
    legalName: companyName,
    directorName: name,
    email,
    baseCurrency: currency,
    locale,
    userId,
    role: "owner",
  });

  await startSession(userId, companyId, locale);
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}

/** Open the pre-seeded demo workspace with a single click. */
export async function openDemoAction(): Promise<void> {
  const demo = one<{ id: number; locale: string; name: string }>(
    "SELECT id, locale, name FROM users WHERE is_demo = 1 ORDER BY id LIMIT 1",
  );
  if (!demo) redirect("/login?error=demo");
  const membership = one<{ company_id: number }>(
    "SELECT company_id FROM company_members WHERE user_id = ? ORDER BY id LIMIT 1",
    [demo.id],
  );
  await startSession(demo.id, membership?.company_id ?? null, demo.locale);
  redirect("/dashboard");
}

export async function switchCompanyAction(companyId: number): Promise<void> {
  const store = await cookies();
  store.set(COMPANY_COOKIE, String(companyId), { path: "/", sameSite: "lax", maxAge: 31_536_000 });
  redirect("/dashboard");
}

export async function createCompanyAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { requireUser } = await import("@/lib/auth/guard");
  const { membershipsForUser } = await import("@/lib/auth/session");
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { ok: false, error: "Enter the company name." };
  const currency = String(formData.get("currency") ?? "UZS");
  const locale = (String(formData.get("locale") ?? "uz") as "uz" | "ru" | "en") ?? "uz";
  const companyId = createCompany({
    name,
    legalName: String(formData.get("legalName") ?? name),
    taxId: String(formData.get("taxId") ?? "") || undefined,
    baseCurrency: currency,
    taxRegime: (String(formData.get("taxRegime") ?? "vat") as "vat" | "turnover" | "general") ?? "vat",
    locale,
    userId: user.id,
    role: "owner",
  });
  const store = await cookies();
  store.set(COMPANY_COOKIE, String(companyId), { path: "/", sameSite: "lax", maxAge: 31_536_000 });
  void membershipsForUser;
  redirect("/dashboard");
}

export async function ensureDemoUserExists(): Promise<boolean> {
  return Boolean(one<{ id: number }>("SELECT id FROM users WHERE is_demo = 1"));
}

export async function userCountAction(): Promise<number> {
  return all<{ count: number }>("SELECT COUNT(*) AS count FROM users")[0]?.count ?? 0;
}
