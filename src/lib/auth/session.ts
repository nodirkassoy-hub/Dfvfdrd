/**
 * BUXAI authentication & session handling.
 *
 * • Passwords are hashed with scrypt (N=16384) and a per-user random salt.
 * • Sessions are opaque random tokens; only a SHA-256 hash is stored server
 *   side, and the browser holds the token in an httpOnly, SameSite=Lax cookie.
 * • The session secret never reaches the client — there is no client-side code
 *   path that reads credentials or keys.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { all, insert, nowISO, one, run } from "@/lib/db";
import { permissionsFor, type Permission, type Role } from "./permissions";

export const SESSION_COOKIE = "buxai_session";
const SESSION_TTL_DAYS = 14;

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  locale: string;
  theme: string;
  isDemo: boolean;
};

export type CompanyMembership = {
  companyId: number;
  companyName: string;
  role: Role;
  permissions: Permission[];
  isDemo: boolean;
};

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): { hash: string; salt: string } {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(userId: number, userAgent?: string, ip?: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString();
  insert("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)", [
    hashToken(token),
    userId,
    nowISO(),
    expiresAt,
    userAgent ?? null,
    ip ?? null,
  ]);
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    run("DELETE FROM sessions WHERE id = ?", [hashToken(token)]);
  }
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = one<{
    user_id: number;
    expires_at: string;
    email: string;
    name: string;
    locale: string;
    theme: string;
    is_demo: number;
  }>(
    `SELECT s.user_id, s.expires_at, u.email, u.name, u.locale, u.theme, u.is_demo
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    [hashToken(token)],
  );
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    run("DELETE FROM sessions WHERE id = ?", [hashToken(token)]);
    return null;
  }
  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    locale: row.locale,
    theme: row.theme,
    isDemo: Boolean(row.is_demo),
  };
}

export function membershipsForUser(userId: number): CompanyMembership[] {
  const rows = all<{
    company_id: number;
    name: string;
    role: Role;
    permissions: string;
    is_demo: number;
    status: string;
  }>(
    `SELECT m.company_id, c.name, m.role, m.permissions, c.is_demo, m.status
       FROM company_members m JOIN companies c ON c.id = m.company_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY c.name`,
    [userId],
  );
  return rows.map((row) => ({
    companyId: row.company_id,
    companyName: row.name,
    role: row.role,
    permissions: permissionsFor(row.role, safeParse(row.permissions)),
    isDemo: Boolean(row.is_demo),
  }));
}

function safeParse(value: string | null): Permission[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as Permission[]) : [];
  } catch {
    return [];
  }
}

export async function requestMeta(): Promise<{ userAgent?: string; ip?: string }> {
  const h = await headers();
  return {
    userAgent: h.get("user-agent") ?? undefined,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  };
}
