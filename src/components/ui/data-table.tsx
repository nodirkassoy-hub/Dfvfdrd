"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Badge, cx, EmptyState, STATUS_TONES } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import { money, qty } from "@/lib/format";
import { formatDate } from "@/lib/dates";

/**
 * Declarative data table.
 *
 * Column definitions are plain serialisable data (no render callbacks), so a
 * server component can hand rows straight to this client component. Sorting,
 * search and column visibility happen in the browser; filtering that changes
 * the dataset (status, period) is done on the server through the URL.
 */
export type ColumnKind = "text" | "money" | "qty" | "date" | "badge" | "link" | "number" | "percent" | "boolean";

export type Column = {
  key: string;
  label: string;
  kind?: ColumnKind;
  align?: "left" | "right" | "center";
  /** For kind="link": target template, `{id}` is replaced by the row id. */
  href?: string;
  /** Secondary line rendered under the main value (another field of the row). */
  sub?: string;
  /** Hide on narrow screens to keep mobile tables readable. */
  hideOnMobile?: boolean;
  sortable?: boolean;
  width?: string;
  /** For kind="badge": map the raw value to a translated label via `status.*`. */
  translateBadge?: boolean;
  /** For kind="money"/"qty": currency/unit override field on the row. */
  currencyField?: string;
  unitField?: string;
  /** Precision hint for kind="qty". */
  emphasis?: boolean;
};

export type Row = Record<string, unknown>;

export function DataTable({
  columns,
  rows,
  empty,
  rowHref,
  initialSort,
  toolbar,
  dense,
  footer,
}: {
  columns: Column[];
  rows: Row[];
  empty?: { title: string; description?: string; action?: React.ReactNode };
  rowHref?: string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  toolbar?: React.ReactNode;
  dense?: boolean;
  footer?: React.ReactNode;
}) {
  const { t, locale, currency } = useApp();
  const [sort, setSort] = React.useState(initialSort ?? null);
  const [query, setQuery] = React.useState("");
  const [hidden, setHidden] = React.useState<string[]>([]);
  const [columnsOpen, setColumnsOpen] = React.useState(false);

  const visible = columns.filter((column) => !hidden.includes(column.key));

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const base = needle
      ? rows.filter((row) =>
          visible.some((column) => {
            const value = row[column.key];
            if (value === null || value === undefined) return false;
            if (typeof value === "number") return String(value).includes(needle);
            return String(value).toLowerCase().includes(needle);
          }),
        )
      : rows;
    if (!sort) return base;
    const column = columns.find((entry) => entry.key === sort.key);
    if (!column) return base;
    const direction = sort.dir === "asc" ? 1 : -1;
    return [...base].sort((left, right) => {
      const a = left[sort.key];
      const b = right[sort.key];
      if (typeof a === "number" && typeof b === "number") return (a - b) * direction;
      return String(a ?? "").localeCompare(String(b ?? "")) * direction;
    });
  }, [rows, query, sort, columns, visible]);

  const cell = (row: Row, column: Column): React.ReactNode => {
    const raw = row[column.key];
    switch (column.kind) {
      case "money": {
        const code = column.currencyField ? String(row[column.currencyField] ?? currency) : currency;
        return <span className={cx("num", column.emphasis && "font-medium")}>{money(Number(raw ?? 0), code, locale)}</span>;
      }
      case "qty": {
        const unit = column.unitField ? String(row[column.unitField] ?? "") : "";
        return (
          <span className={cx("num", column.emphasis && "font-medium")}>
            {qty(Number(raw ?? 0), locale)}
            {unit ? ` ${unit}` : ""}
          </span>
        );
      }
      case "percent":
        return <span className="num">{Number(raw ?? 0).toFixed(1)}%</span>;
      case "date":
        return <span className="num whitespace-nowrap">{formatDate(String(raw ?? ""), locale)}</span>;
      case "badge": {
        const value = String(raw ?? "");
        const label = column.translateBadge ? t(`status.${value}`) : value.replace(/_/g, " ");
        return <Badge tone={STATUS_TONES[value] ?? "neutral"}>{label}</Badge>;
      }
      case "boolean":
        return raw ? <Icon name="check" size={15} className="text-positive-600" /> : <span className="text-subtle">—</span>;
      case "link":
        return (
          <Link
            href={(column.href ?? "{id}").replace("{id}", String(row.id ?? ""))}
            className="num font-medium text-brand-600 hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {String(raw ?? "—")}
          </Link>
        );
      case "number":
        return <span className="num">{String(raw ?? "—")}</span>;
      default:
        return (
          <span className="block min-w-0">
            <span className={cx("block truncate", column.emphasis && "font-medium")}>{raw === null || raw === undefined || raw === "" ? "—" : String(raw)}</span>
            {column.sub ? <span className="block truncate text-[11.5px] text-subtle">{String(row[column.sub] ?? "")}</span> : null}
          </span>
        );
    }
  };

  return (
    <div className="card overflow-hidden">
      {toolbar || columns.length > 4 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--border)] px-3 py-2.5">
          <label className="relative flex min-w-0 flex-1 items-center sm:max-w-[280px]">
            <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 text-subtle" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("common.search")}
              className="focus-ring h-9 w-full rounded-[10px] border border-[color:var(--border)] surface-muted pl-8 pr-2.5 text-[13px] outline-none"
            />
          </label>
          {toolbar}
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setColumnsOpen((value) => !value)}
              className="focus-ring flex h-9 items-center gap-1.5 rounded-[10px] border border-[color:var(--border)] px-2.5 text-[12.5px] text-muted hover:surface-muted"
            >
              <Icon name="columns" size={15} />
              <span className="hidden sm:inline">{t("common.columns")}</span>
            </button>
            {columnsOpen ? (
              <div className="animate-scale-in absolute right-0 top-[calc(100%+6px)] z-30 w-[210px] rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] p-1.5 shadow-[var(--shadow-pop)]">
                {columns.map((column) => (
                  <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded-[9px] px-2 py-1.5 text-[12.5px] hover:surface-muted">
                    <input
                      type="checkbox"
                      checked={!hidden.includes(column.key)}
                      onChange={() =>
                        setHidden((current) => (current.includes(column.key) ? current.filter((key) => key !== column.key) : [...current, column.key]))
                      }
                      className="h-3.5 w-3.5 accent-[color:var(--brand-600)]"
                    />
                    {column.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Icon name="search" size={20} />}
          title={query ? t("common.noResults") : (empty?.title ?? t("common.noData"))}
          description={query ? t("common.noResultsHint") : empty?.description}
          action={query ? undefined : empty?.action}
        />
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-full text-[13px]">
            <thead>
              <tr className="border-b border-[color:var(--border)] text-left text-[11.5px] uppercase tracking-wide text-subtle">
                {visible.map((column) => (
                  <th
                    key={column.key}
                    style={column.width ? { width: column.width } : undefined}
                    className={cx(
                      "px-3 py-2 font-medium first:pl-4 last:pr-4",
                      column.align === "right" && "text-right",
                      column.align === "center" && "text-center",
                      column.hideOnMobile && "hidden lg:table-cell",
                    )}
                  >
                    {column.sortable === false ? (
                      column.label
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setSort((current) =>
                            current?.key === column.key
                              ? { key: column.key, dir: current.dir === "asc" ? "desc" : "asc" }
                              : { key: column.key, dir: "asc" },
                          )
                        }
                        className="inline-flex items-center gap-1 hover:text-[color:var(--text)]"
                      >
                        {column.label}
                        {sort?.key === column.key ? <Icon name={sort.dir === "asc" ? "chevronUp" : "chevronDown"} size={12} /> : null}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, index) => (
                <tr
                  key={String(row.id ?? index)}
                  className={cx(
                    "border-b border-[color:var(--border)] last:border-0 hover:surface-muted",
                    rowHref && "cursor-pointer",
                  )}
                  onClick={
                    rowHref
                      ? () => {
                          window.location.href = rowHref.replace("{id}", String(row.id ?? ""));
                        }
                      : undefined
                  }
                >
                  {visible.map((column) => (
                    <td
                      key={column.key}
                      className={cx(
                        dense ? "px-3 py-1.5" : "px-3 py-2.5",
                        "first:pl-4 last:pr-4",
                        column.align === "right" && "text-right",
                        column.align === "center" && "text-center",
                        column.hideOnMobile && "hidden lg:table-cell",
                      )}
                    >
                      {cell(row, column)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border)] px-4 py-2 text-[12px] text-subtle">
        <span>
          {t("common.showing")} {filtered.length} {t("common.of")} {rows.length}
        </span>
        {footer}
      </div>
    </div>
  );
}
