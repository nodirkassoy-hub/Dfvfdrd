"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { cx, Tooltip } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import { findNavItem, NAV_SECTIONS } from "@/lib/nav";
import { switchCompanyAction } from "@/app/actions/auth";

export type ShellCompany = { id: number; name: string; role: string; isDemo: boolean };

export function Topbar({
  companies,
  activeCompanyId,
  isDemo,
  badges,
  unread,
  onMenu,
  onSearch,
  onLogout,
}: {
  companies: ShellCompany[];
  activeCompanyId: number;
  isDemo: boolean;
  badges: Record<string, number>;
  unread: number;
  onMenu: () => void;
  onSearch: () => void;
  onLogout: () => void;
}) {
  const pathname = usePathname();
  const { t, locale, setLocale, theme, setTheme, companyName } = useApp();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const active = findNavItem(pathname);
  const section = NAV_SECTIONS.find((entry) => entry.items.some((item) => item.key === active?.key));
  const activeCompany = companies.find((company) => company.id === activeCompanyId) ?? companies[0];

  React.useEffect(() => {
    const close = () => {
      setMenuOpen(false);
      setSwitcherOpen(false);
    };
    window.addEventListener("buxai:route", close);
    return () => window.removeEventListener("buxai:route", close);
  }, []);

  return (
    <header className="no-print sticky top-0 z-30 flex h-[60px] shrink-0 items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface-blur)] px-3 backdrop-blur-md sm:px-4">
      <button type="button" onClick={onMenu} className="focus-ring flex h-9 w-9 items-center justify-center rounded-[10px] text-muted hover:surface-muted lg:hidden" aria-label="Menu">
        <Icon name="menu" size={18} />
      </button>

      <div className="hidden min-w-0 items-center gap-2 lg:flex">
        <span className="text-[12.5px] text-subtle">{section ? t(section.labelKey) : t("brand.name")}</span>
        <Icon name="chevronRight" size={13} className="text-subtle" />
        <span className="truncate text-[13.5px] font-medium">{active ? t(active.labelKey) : t("brand.name")}</span>
      </div>

      {isDemo ? (
        <span className="ml-1 hidden items-center gap-1.5 rounded-full bg-warning-50 px-2.5 py-1 text-[11px] font-medium text-warning-700 sm:inline-flex">
          <Icon name="flask" size={12} />
          {t("brand.demoData")}
        </span>
      ) : null}

      <button
        type="button"
        onClick={onSearch}
        className="focus-ring ml-auto flex h-9 min-w-0 items-center gap-2 rounded-[11px] border border-[color:var(--border)] surface px-3 text-left text-[13px] text-subtle transition-colors hover:border-brand-300 lg:w-[300px]"
      >
        <Icon name="search" size={15} />
        <span className="hidden truncate lg:inline">{t("search.placeholder")}</span>
        <span className="num ml-auto hidden rounded-[6px] border border-[color:var(--border)] px-1.5 py-0.5 text-[10.5px] lg:inline">Ctrl K</span>
      </button>

      <Tooltip label={theme === "dark" ? "Light theme" : "Dark theme"}>
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="focus-ring flex h-9 w-9 items-center justify-center rounded-[10px] text-muted hover:surface-muted"
          aria-label="Toggle theme"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
        </button>
      </Tooltip>

      <div className="relative">
        <Tooltip label="Interface language">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="focus-ring flex h-9 items-center gap-1 rounded-[10px] px-2 text-[12.5px] font-medium uppercase text-muted hover:surface-muted"
          >
            {locale}
            <Icon name="chevronDown" size={13} />
          </button>
        </Tooltip>
        {menuOpen ? (
          <Dropdown onClose={() => setMenuOpen(false)}>
            {(["uz", "ru", "en"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLocale(code)}
                className={cx(
                  "flex w-full items-center justify-between rounded-[9px] px-2.5 py-1.5 text-left text-[13px] hover:surface-muted",
                  code === locale && "text-brand-600",
                )}
              >
                {code === "uz" ? "O'zbekcha" : code === "ru" ? "Русский" : "English"}
                {code === locale ? <Icon name="check" size={14} /> : null}
              </button>
            ))}
          </Dropdown>
        ) : null}
      </div>

      <Tooltip label={t("nav.notifications")}>
        <Link href="/notifications" className="focus-ring relative flex h-9 w-9 items-center justify-center rounded-[10px] text-muted hover:surface-muted">
          <Icon name="bell" size={17} />
          {unread > 0 ? (
            <span className="num absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-negative-500 px-1 text-[9.5px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Link>
      </Tooltip>

      <div className="relative">
        <button
          type="button"
          onClick={() => setSwitcherOpen((value) => !value)}
          className="focus-ring flex h-9 max-w-[210px] items-center gap-2 rounded-[10px] border border-[color:var(--border)] surface px-2.5"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-brand-600 text-[10px] font-semibold text-white">
            {(activeCompany?.name ?? companyName).slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden min-w-0 truncate text-[12.5px] font-medium sm:inline">{activeCompany?.name ?? companyName}</span>
          <Icon name="chevronDown" size={13} className="text-subtle" />
        </button>
        {switcherOpen ? (
          <Dropdown onClose={() => setSwitcherOpen(false)} width={280}>
            <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-subtle">{t("brand.companies")}</p>
            <div className="max-h-[240px] overflow-y-auto scroll-thin">
              {companies.map((company) => (
                <form key={company.id} action={switchCompanyAction.bind(null, company.id)}>
                  <button
                    type="submit"
                    className={cx(
                      "flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-left hover:surface-muted",
                      company.id === activeCompanyId && "text-brand-600",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{company.name}</span>
                      <span className="block text-[11px] capitalize text-subtle">
                        {company.role}
                        {company.isDemo ? ` · ${t("brand.demoCompany")}` : ""}
                      </span>
                    </span>
                    {company.id === activeCompanyId ? <Icon name="check" size={14} /> : null}
                  </button>
                </form>
              ))}
            </div>
            <div className="mt-1 border-t border-[color:var(--border)] pt-1">
              <Link href="/onboarding" className="flex items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-[13px] hover:surface-muted">
                <Icon name="plus" size={14} />
                {t("team.newCompany")}
              </Link>
              <Link href="/settings" className="flex items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-[13px] hover:surface-muted">
                <Icon name="settings" size={14} />
                {t("nav.settings")}
              </Link>
            </div>
          </Dropdown>
        ) : null}
      </div>

      <Tooltip label={t("notif.notifications")}>
        <button
          type="button"
          onClick={onLogout}
          className="focus-ring flex h-9 w-9 items-center justify-center rounded-[10px] text-muted hover:surface-muted"
          aria-label="Sign out"
        >
          <Icon name="logout" size={17} />
        </button>
      </Tooltip>
      <span className="sr-only">{badges.xato ?? 0}</span>
    </header>
  );
}

function Dropdown({ children, onClose, width = 180 }: { children: React.ReactNode; onClose: () => void; width?: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ width }}
      className="animate-scale-in absolute right-0 top-[calc(100%+8px)] z-50 rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface)] p-1.5 shadow-[var(--shadow-pop)]"
    >
      {children}
    </div>
  );
}
