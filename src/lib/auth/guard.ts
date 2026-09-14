/**
 * Server-side access guards.
 *
 * Every page and every mutation goes through these helpers, so a request can
 * never read or write another company's data, and role permissions are enforced
 * on the server (the UI hiding a button is never the only protection).
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { all, one } from "@/lib/db";
import { getCompany, type CompanyRecord } from "@/lib/services/company";
import { getCurrentUser, clearSession, membershipsForUser, type CompanyMembership, type SessionUser } from "./session";
import { can, type Permission } from "./permissions";

export const COMPANY_COOKIE = "buxai_company";

export type ActiveContext = {
  user: SessionUser;
  company: CompanyRecord;
  membership: CompanyMembership;
  permissions: Permission[];
  currency: string;
  locale: "uz" | "ru" | "en";
  companies: CompanyMembership[];
};

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function getLocale(): Promise<"uz" | "ru" | "en"> {
  const store = await cookies();
  const value = store.get("buxai_locale")?.value;
  return value === "ru" || value === "en" ? value : "uz";
}

export async function getTheme(): Promise<"light" | "dark"> {
  const store = await cookies();
  return store.get("buxai_theme")?.value === "dark" ? "dark" : "light";
}

export async function requireContext(): Promise<ActiveContext> {
  const user = await requireUser();
  const memberships = membershipsForUser(user.id);
  if (!memberships.length) redirect("/onboarding");

  const store = await cookies();
  const cookieCompany = Number(store.get(COMPANY_COOKIE)?.value ?? 0);
  const membership = memberships.find((item) => item.companyId === cookieCompany) ?? memberships[0];
  const company = getCompany(membership.companyId);
  if (!company) redirect("/onboarding");

  return {
    user,
    company,
    membership,
    permissions: membership.permissions,
    currency: company.base_currency,
    locale: await getLocale(),
    companies: memberships,
  };
}

export function requirePermission(context: ActiveContext, permission: Permission): void {
  if (!can(context.permissions, permission)) {
    throw new Error(`FORBIDDEN:${permission}`);
  }
}

export async function signOutAndRedirect(): Promise<void> {
  await clearSession();
  redirect("/login");
}

export function ensureCompanyScope(context: ActiveContext, companyId: number): void {
  if (context.company.id !== companyId) {
    throw new Error("FORBIDDEN:cross-company access");
  }
}

export function listUsers(companyId: number) {
  return all(
    `SELECT u.id, u.name, u.email, u.last_login_at AS lastLoginAt, m.role, m.status
       FROM company_members m JOIN users u ON u.id = m.user_id
      WHERE m.company_id = ? ORDER BY u.name`,
    [companyId],
  );
}

export function userCount(): number {
  return one<{ count: number }>("SELECT COUNT(*) AS count FROM users")?.count ?? 0;
}
