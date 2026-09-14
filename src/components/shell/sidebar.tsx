"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { cx } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import { NAV_SECTIONS, type NavItem } from "@/lib/nav";

export function Sidebar({
  badges,
  collapsed,
  onToggle,
  onNavigate,
}: {
  badges: Record<string, number>;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { t, companyName } = useApp();
  const [openSections, setOpenSections] = React.useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const section of NAV_SECTIONS) initial[section.key] = true;
    return initial;
  });

  const isActive = (href: string) => {
    const base = href.split("?")[0];
    if (base === "/documents" && href.includes("?")) return false;
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  const badgeFor = (item: NavItem) => {
    if (!item.badgeKey) return 0;
    const value = badges[item.badgeKey];
    return typeof value === "number" ? value : 0;
  };

  return (
    <aside
      className={cx(
        "surface flex h-full flex-col border-r border-[color:var(--border)] transition-[width] duration-200",
        collapsed ? "w-[68px]" : "w-[248px]",
      )}
    >
      <div className={cx("flex h-[60px] shrink-0 items-center gap-2.5 border-b border-[color:var(--border)] px-4")}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-600 text-white shadow-[0_2px_8px_rgba(67,56,202,0.35)]">
          <Icon name="logo" size={17} />
        </span>
        {!collapsed ? (
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">BUXAI</span>
            <span className="block truncate text-[10.5px] text-subtle">{t("brand.shortTagline")}</span>
          </span>
        ) : null}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
          className="focus-ring ml-auto hidden rounded-[8px] p-1.5 text-subtle hover:surface-muted lg:block"
        >
          <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={15} />
        </button>
      </div>

      <nav className="scroll-thin flex-1 overflow-y-auto px-2.5 py-3">
        {NAV_SECTIONS.map((section) => {
          const open = openSections[section.key] ?? true;
          return (
            <div key={section.key} className="mb-3">
              {!collapsed ? (
                <button
                  type="button"
                  onClick={() => setOpenSections((current) => ({ ...current, [section.key]: !open }))}
                  className="focus-ring mb-1 flex w-full items-center justify-between rounded-[6px] px-2 py-1 text-[10.5px] font-semibold tracking-[0.08em] text-subtle uppercase hover:text-[color:var(--text-muted)]"
                >
                  {t(section.labelKey)}
                  <Icon name="chevronDown" size={12} className={cx("transition-transform", !open && "-rotate-90")} />
                </button>
              ) : (
                <div className="mx-auto my-2 h-px w-6 bg-[color:var(--border)]" />
              )}
              {(open || collapsed) &&
                section.items.map((item) => {
                  const active = isActive(item.href) || (item.key === "all-documents" && pathname === "/documents");
                  const badge = badgeFor(item);
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      onClick={onNavigate}
                      title={collapsed ? t(item.labelKey) : undefined}
                      className={cx(
                        "group relative mb-0.5 flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium transition-colors",
                        active
                          ? "bg-brand-50 text-brand-700"
                          : "text-[color:var(--text-muted)] hover:surface-muted hover:text-[color:var(--text)]",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      {active ? <span className="absolute left-0 h-4 w-[3px] rounded-r-full bg-brand-600" /> : null}
                      <Icon name={item.icon} size={17} className={active ? "text-brand-600" : "text-[color:var(--text-subtle)] group-hover:text-[color:var(--text-muted)]"} />
                      {!collapsed ? <span className="truncate">{t(item.labelKey)}</span> : null}
                      {badge > 0 ? (
                        <span
                          className={cx(
                            "num ml-auto rounded-full px-1.5 text-[10.5px] font-semibold",
                            active ? "bg-brand-600 text-white" : "bg-warning-500 text-white",
                            collapsed && "absolute -top-0.5 right-1 px-1",
                          )}
                        >
                          {badge > 99 ? "99+" : badge}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
            </div>
          );
        })}
      </nav>

      {!collapsed ? (
        <div className="shrink-0 border-t border-[color:var(--border)] p-3">
          <div className="rounded-[12px] border border-[color:var(--border)] surface-muted p-3">
            <div className="flex items-center gap-2">
              <Icon name="shield" size={15} className="text-positive-600" />
              <span className="text-[11.5px] font-semibold">{t("common.doubleEntry")}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-subtle">{t("common.ledgerBalanced")} · {companyName}</p>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
