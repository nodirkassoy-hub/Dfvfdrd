import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";

export type DB = Database.Database;

declare global {
  // eslint-disable-next-line no-var
  var __buxaiDb: DB | undefined;
}

function resolveDbPath(): string {
  const configured = process.env.BUXAI_DB_PATH;
  const target = configured
    ? path.isAbsolute(configured)
      ? configured
      : path.join(process.cwd(), configured)
    : path.join(process.cwd(), "data", "buxai.db");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

function open(): DB {
  const db = new Database(resolveDbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA_SQL);
  return db;
}

export function getDb(): DB {
  if (!globalThis.__buxaiDb) {
    globalThis.__buxaiDb = open();
  }
  return globalThis.__buxaiDb;
}

export function closeDb(): void {
  globalThis.__buxaiDb?.close();
  globalThis.__buxaiDb = undefined;
}

/* ------------------------------------------------------------------ helpers */
export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[];
}

export function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  return getDb().prepare(sql).get(...(params as never[])) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): Database.RunResult {
  return getDb().prepare(sql).run(...(params as never[]));
}

export function insert(sql: string, params: unknown[] = []): number {
  const res = getDb().prepare(sql).run(...(params as never[]));
  return Number(res.lastInsertRowid);
}

/** Runs `fn` inside an IMMEDIATE transaction. Nested calls reuse the outer transaction. */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  if (db.inTransaction) return fn();
  const wrapped = db.transaction(fn);
  return wrapped();
}

export function nowISO(): string {
  return new Date().toISOString();
}

export type Row = Record<string, unknown>;
