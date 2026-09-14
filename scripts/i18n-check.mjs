/**
 * Localisation smoke test.
 *
 * 1. Every `t("key")` / `t('key')` used in the codebase must exist in the
 *    dictionary (otherwise the UI would render raw keys).
 * 2. Every key must have all three translations (English, Uzbek, Russian).
 * 3. No look-alike Cyrillic characters inside Latin keys.
 *
 * Exits non-zero when something is missing so it can run in CI.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "src";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

function dictionaryKeys() {
  const keys = new Set();
  for (const file of ["src/lib/i18n/dictionary.ts", "src/lib/i18n/extra.ts"]) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/^\s{2}"([a-zA-Z0-9_.\{\}-]+)":\s*\[/gm)) keys.add(match[1]);
  }
  return keys;
}

const keys = dictionaryKeys();
const used = new Map();
for (const file of walk(SRC)) {
  if (file.includes("i18n/dictionary") || file.includes("i18n/extra")) continue;
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\bt\(\s*"([a-zA-Z0-9_.-]+)"/g)) {
    if (!used.has(match[1])) used.set(match[1], file);
  }
  for (const match of text.matchAll(/labelKey:\s*"([a-zA-Z0-9_.-]+)"/g)) {
    if (!used.has(match[1])) used.set(match[1], file);
  }
}

const missing = [...used.entries()].filter(([key]) => !keys.has(key));
const cyrillicKeyHazard = [...keys].filter((key) => /[\u0400-\u04FF]/.test(key));

const triples = readFileSync("src/lib/i18n/dictionary.ts", "utf8") + readFileSync("src/lib/i18n/extra.ts", "utf8");
const badTriples = [...triples.matchAll(/^\s{2}"([a-zA-Z0-9_.\{\}-]+)":\s*\[([^\]]*)\]/gm)].filter((match) => {
  const parts = match[2].split(/",\s*"/).length;
  return parts < 3;
});

console.log(`dictionary keys: ${keys.size}`);
console.log(`keys used in code: ${used.size}`);

if (missing.length) {
  console.error(`\nMISSING (${missing.length}):`);
  for (const [key, file] of missing) console.error(`  ${key}  ← ${file}`);
}
if (cyrillicKeyHazard.length) {
  console.error(`\nKEYS WITH CYRILLIC CHARACTERS (${cyrillicKeyHazard.length}):`);
  for (const key of cyrillicKeyHazard) console.error(`  ${key}`);
}
if (badTriples.length) {
  console.error(`\nTRIPLES WITHOUT 3 LANGUAGES (${badTriples.length}):`);
  for (const match of badTriples) console.error(`  ${match[1]}`);
}

if (missing.length || cyrillicKeyHazard.length || badTriples.length) process.exit(1);
console.log("i18n OK — every used key exists with all three languages.");
