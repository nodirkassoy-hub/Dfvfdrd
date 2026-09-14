"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";
import { cx, Spinner } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import { NAV_SECTIONS, type NavItem } from "@/lib/nav";
import { searchAction } from "@/app/actions/search";
import type { SearchHit } from "@/lib/services/operations";

const HIT_ICONS: Record<SearchHit["type"], IconName> = {
  invoice: "invoice",
  bill: "truck",
  expense: "receipt",
  contact: "users",
  product: "box",
  employee: "badge",
  document: "file",
  entry: "ledger",
  account: "layers",
  bank: "bank",
};
import { money } from "@/lib/format";

type Command = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: IconName;
  group: string;
  keywords?: string;
};

const QUICK_COMMANDS: Command[] = [
  { id: "new-invoice", label: "New invoice", href: "/sales/invoices/new", icon: "invoice", group: "Quick actions", keywords: "sales billing" },
  { id: "new-expense", label: "Record expense", href: "/purchases/expenses/new", icon: "receipt", group: "Quick actions", keywords: "cost" },
  { id: "new-bill", label: "Enter supplier bill", href: "/purchases/bills/new", icon: "truck", group: "Quick actions" },
  { id: "new-payment", label: "Record payment", href: "/sales/payments/new", icon: "wallet", group: "Quick actions" },
  { id: "new-journal", label: "Manual journal entry", href: "/accounting/journal-entries/new", icon: "ledger", group: "Quick actions" },
  { id: "upload-document", label: "Scan document (OCR)", href: "/documents/scanner", icon: "scan", group: "Quick actions" },
  { id: "import-statement", label: "Import bank statement", href: "/banking/reconciliation?tab=import", icon: "upload", group: "Quick actions" },
  { id: "run-radar", label: "Run Xato Radar", href: "/ai-center/xato-radar", icon: "radar", group: "Quick actions" },
  { id: "close-period", label: "Month-end close", href: "/month-end-close", icon: "lock", group: "Quick actions" },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { t, locale } = useApp();
  const [query, setQuery] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const navCommands = React.useMemo<Command[]>(
    () =>
      NAV_SECTIONS.flatMap((section) =>
        section.items.map((item: NavItem) => ({
          id: `nav-${item.key}`,
          label: t(item.labelKey),
          href: item.href,
          icon: item.icon,
          group: t(section.labelKey),
        })),
      ),
    [t],
  );

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = [...QUICK_COMMANDS.map((command) => ({ ...command, group: command.group === "Quick actions" ? t("search.quickActions") : command.group })), ...navCommands];
    if (!needle) return pool.slice(0, 9);
    return pool.filter((command) => `${command.label} ${command.href} ${command.keywords ?? ""}`.toLowerCase().includes(needle)).slice(0, 12);
  }, [navCommands, query, t]);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    setHits([]);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const needle = query.trim();
    if (needle.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const results = await searchAction(needle);
        if (!cancelled) setHits(results);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const go = React.useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  const items = React.useMemo(() => [...filtered.map((command) => ({ kind: "command" as const, href: command.href, id: command.id })), ...hits.map((hit) => ({ kind: "hit" as const, href: hit.href, id: `hit-${hit.type}-${hit.id}` }))], [filtered, hits]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((value) => Math.min(value + 1, Math.max(0, items.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((value) => Math.max(0, value - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = items[cursor];
      if (target) go(target.href);
    } else if (event.key === "Escape") {
      onClose();
    }
  };

  if (!open) return null;

  let flatIndex = -1;
  const groups = new Map<string, Command[]>();
  for (const command of filtered) {
    const list = groups.get(command.group) ?? [];
    list.push(command);
    groups.set(command.group, list);
  }

  return (
    <div className="no-print fixed inset-0 z-[70] flex items-start justify-center px-3 pt-[9vh] sm:pt-[12vh]">
      <button type="button" aria-label="Close" onClick={onClose} className="animate-fade-in absolute inset-0 bg-ink-900/45 backdrop-blur-[3px]" />
      <div
        role="dialog"
        aria-modal
        className="animate-scale-in relative w-full max-w-[620px] overflow-hidden rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-pop)]"
      >
        <div className="flex items-center gap-3 border-b border-[color:var(--border)] px-4">
          <Icon name="search" size={17} className="text-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("search.paletteHint")}
            className="h-[52px] flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-[color:var(--text-subtle)]"
          />
          {loading ? <Spinner className="h-4 w-4 text-subtle" /> : null}
          <span className="num hidden rounded-[6px] border border-[color:var(--border)] px-1.5 py-0.5 text-[10.5px] text-subtle sm:inline">ESC</span>
        </div>

        <div className="max-h-[58vh] overflow-y-auto scroll-thin p-2">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-subtle">
              {query.trim().length < 2 ? t("search.hintMin") : t("search.noResults")}
            </p>
          ) : null}

          {[...groups.entries()].map(([group, commands]) => (
            <div key={group} className="mb-1">
              <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-subtle">{group}</p>
              {commands.map((command) => {
                flatIndex += 1;
                const index = flatIndex;
                return (
                  <button
                    key={command.id}
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => go(command.href)}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2 text-left transition-colors",
                      cursor === index ? "bg-brand-50 text-brand-700" : "hover:surface-muted",
                    )}
                  >
                    <Icon name={command.icon} size={16} className={cursor === index ? "text-brand-600" : "text-subtle"} />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{command.label}</span>
                    <Icon name="arrowRight" size={14} className="shrink-0 text-subtle" />
                  </button>
                );
              })}
            </div>
          ))}

          {hits.length > 0 ? (
            <div>
              <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-subtle">{t("search.records")}</p>
              {hits.map((hit) => {
                flatIndex += 1;
                const index = flatIndex;
                return (
                  <button
                    key={`${hit.type}-${hit.id}`}
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => go(hit.href)}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2 text-left transition-colors",
                      cursor === index ? "bg-brand-50 text-brand-700" : "hover:surface-muted",
                    )}
                  >
                    <Icon name={HIT_ICONS[hit.type] ?? "info"} size={16} className="shrink-0 text-subtle" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{hit.title}</span>
                      <span className="block truncate text-[11.5px] text-subtle">{hit.subtitle}</span>
                    </span>
                    {typeof hit.amount === "number" ? (
                      <span className="num shrink-0 text-[12.5px] text-muted">{money(hit.amount, hit.currency ?? "UZS", locale)}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-[color:var(--border)] px-4 py-2 text-[11px] text-subtle">
          <span>↑↓ {t("search.navigate")} · ↵ {t("search.open")}</span>
          <span>{t("brand.tagline")}</span>
        </div>
      </div>
    </div>
  );
}
