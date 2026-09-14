# BUXAI — financial operating system for business

BUXAI is an accounting and financial management platform: a real double-entry
ledger at the centre, with invoicing, purchasing, banking and reconciliation,
inventory, payroll, tax, reporting, AI analysis and error detection all reading
from — and writing to — that single ledger.

Nothing in the product is a mock-up. Every number on every screen is a query
against the same posted journal, and every mutation goes through one posting
service that refuses unbalanced entries.

```
Invoice → Payment → Receivable → Bank → General ledger → Reports
Expense → Payable / Cash / Bank → General ledger → Reports
Purchase → Inventory or Expense → Payable → General ledger → Reports
```

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router, React 19, server actions) |
| Language | TypeScript, `strict` |
| Styling | Tailwind CSS 4 with a token-based theme (light + dark) |
| Database | SQLite via `better-sqlite3` (WAL), schema + views in `src/lib/db/schema.ts` |
| Money | integer minor units everywhere (`src/lib/money.ts`) |
| Fonts | self-hosted Inter and JetBrains Mono (`public/fonts`) |
| i18n | Uzbek (default), Russian, English — one dictionary, no missing keys |
| Scripts | `tsx` for `.mts` maintenance scripts |

No charting, icon, or state-management dependency is used; those primitives are
implemented in `src/components` so the bundle stays small and the visual
language stays consistent.

## Getting started

```bash
npm install
cp .env.example .env            # set BUXAI_SESSION_SECRET
npm run db:reset                # create the schema
npm run seed                    # optional: demo company with 6 months of history
npm run dev                     # http://localhost:3000
```

Demo credentials after `npm run seed`: `demo@buxai.app` / `demo1234`.

Seeded data is a fictional Uzbek logistics company (Zamin Logistics MChJ) and
every row it creates is flagged `is_demo = 1`, so demo records can never be
mixed into a real workspace.

## Quality gates

```bash
npm run typecheck        # tsc --noEmit, strict
npm run i18n             # every key used in code exists in uz/ru/en
npm run test:accounting  # §39 accounting consistency acceptance test (23 checks)
```

`npm run test:accounting` builds an isolated temporary database and asserts the
properties the product depends on, including:

* balanced ledger — total debits equal total credits at every step;
* revenue 100M − expenses 60M = profit 40M; adding a 10M expense moves profit to 30M;
* an unpaid invoice increases receivables; paying it decreases them;
* a duplicated transaction is found by Xato Radar;
* dashboard KPIs, reports and the AI layer return the same figures.

## Architecture

```
src/
  app/
    (app)/            authenticated workspace: dashboard, sales, purchases,
                      banking, inventory, hr, documents, reports, analytics,
                      ai, radar, operations, settings
    actions/          server actions — the only mutation entry points
    login|onboarding  unauthenticated flows
  components/
    ui/               design system: primitives, data table, charts, icons
    shell/            sidebar, topbar, command palette, mobile navigation
    forms/            descriptor-driven forms and line-item editor
  lib/
    accounting/       chart of accounts, posting engine, ledger queries, errors
    services/         business services (sales, purchases, banking, inventory,
                      payroll, documents, intelligence, operations, dashboard)
    auth/             sessions, RBAC permissions, route guards
    db/               connection, schema, views
    i18n/             dictionary and translate()
```

### Accounting rules enforced by the engine

* `postEntry` is the only write path to `journal_entries` / `journal_lines`.
  It rejects fewer than two lines, non-positive amounts, a line with both debit
  and credit, accounts outside the company, archived or non-postable accounts,
  locked periods and any imbalance.
* Documents are corrected by void-and-repost, never by editing posted history.
* `ledger.ts` is the only read path used by reports, the dashboard and the AI
  layer, so those three can never disagree.
* Money is stored as integer minor units, so `TOTAL DEBIT = TOTAL CREDIT` holds
  exactly — there is no floating-point drift to reconcile.

## Environment

See `.env.example`. `BUXAI_SESSION_SECRET` is required in production. An
optional LLM provider can be configured for narrative text only: all figures,
calculations and sources always come from the deterministic ledger engine, and
keys are read server-side only.
