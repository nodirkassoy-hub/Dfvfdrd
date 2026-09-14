/**
 * Development helper: prints a ready-to-use session cookie for the demo user
 * so pages can be inspected from the command line (or a REST client) without
 * walking through the login form.
 *
 *   npx tsx scripts/dev-login.mts
 *
 * It refuses to run when NODE_ENV=production.
 */
const { one } = await import("@/lib/db");
const { createSession } = await import("@/lib/auth/session");

if (process.env.NODE_ENV === "production") {
  console.error("dev-login refuses to run in production");
  process.exit(1);
}

const user = one<{ id: number; email: string; name: string }>(
  "SELECT id, email, name FROM users WHERE is_demo = 1 ORDER BY id LIMIT 1",
);
if (!user) {
  console.error("No demo user found. Run `npm run seed` first.");
  process.exit(1);
}
const membership = one<{ company_id: number }>(
  "SELECT company_id FROM company_members WHERE user_id = ? ORDER BY id LIMIT 1",
  [user.id],
);
const { token, expiresAt } = createSession(user.id);
console.log(`user     : ${user.name} <${user.email}>`);
console.log(`company  : ${membership?.company_id ?? "-"}`);
console.log(`expires  : ${expiresAt}`);
console.log("");
console.log(`buxai_session=${token}`);
console.log(`buxai_company=${membership?.company_id ?? ""}`);
