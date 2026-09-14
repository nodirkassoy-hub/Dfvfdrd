/**
 * Drops the SQLite database (and its WAL side files) and recreates an empty
 * schema. Destructive by design — it prints exactly what it removed.
 *
 *   npm run db:reset
 */
import fs from "node:fs";
import path from "node:path";

const target = process.env.BUXAI_DB_PATH
  ? path.resolve(process.env.BUXAI_DB_PATH)
  : path.resolve(process.cwd(), "data/buxai.db");

const removed: string[] = [];
for (const suffix of ["", "-wal", "-shm"]) {
  const file = `${target}${suffix}`;
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    removed.push(path.relative(process.cwd(), file));
  }
}

const { getDb, one } = await import("@/lib/db");
const db = getDb();
const tables = one<{ count: number }>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");

console.log("BUXAI database reset");
console.log(`  path     : ${path.relative(process.cwd(), target)}`);
console.log(`  removed  : ${removed.length ? removed.join(", ") : "(nothing — file did not exist)"}`);
console.log(`  recreated: ${tables?.count ?? 0} tables with a fresh schema`);
db.close();
