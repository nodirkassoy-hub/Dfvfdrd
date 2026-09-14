"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { cx } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import { MOBILE_NAV } from "@/lib/nav";
import { Sidebar } from "./sidebar";
import { Topbar, type ShellCompany } from "./topbar";
import { CommandPalette } from "./command-palette";

export function AppShell({
  companies,
  activeCompanyId,
  isDemo,
  badges,
  nested,
  children,
}: {
  companies: ShellCompany[];
  activeCompanyId: number;
  isDemo: boolean;
  badges: Record<string, number>;
  nested: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useApp();
  const [collapsed, setCollapsed] = React.useState(false);
  const [drawer, setDrawer] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);

  React.useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
      if (event.key === "/" && !searchOpen) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag !== "input" && tag !== "textarea" && !target?.isContentEditable) {
          event.preventDefault();
          setSearchOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchOpen]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-screen">
      <div
        className={cx(
          "no-print fixed inset-y-0 left-0 z-50 hidden lg:z-40 lg:block",
        )}
      >
        <Sidebar badges={badges} collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      </div>

      {drawer ? (
        <div className="no-print fixed inset-0 z-[60] lg:hidden">
          <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="animate-fade-in absolute inset-0 bg-ink-900/45 backdrop-blur-[2px]" />
          <div className="animate-fade-in absolute inset-y-0 left-0">
            <Sidebar badges={badges} collapsed={false} onToggle={() => setDrawer(false)} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      ) : null}

      <div className={cx("flex min-w-0 flex-1 flex-col transition-[padding] duration-200", collapsed ? "lg:pl-[68px]" : "lg:pl-[248px]")}>
        <Topbar
          companies={companies}
          activeCompanyId={activeCompanyId}
          isDemo={isDemo}
          badges={badges}
          unread={badges.notifications ?? 0}
          onMenu={() => setDrawer(true)}
          onSearch={() => setSearchOpen(true)}
          onLogout={() => {
            window.location.href = "/logout";
          }}
        />

        <main className={cx("min-w-0 flex-1 px-3 pb-24 pt-4 sm:px-5 lg:pb-8", nested ? "mx-auto w-full max-w-[1560px]" : "mx-auto w-full max-w-[1560px]")}>
          {children}
        </main>

        <nav className="no-print fixed bottom-0 left-0 right-0 z-40 flex items-stretch border-t border-[color:var(--border)] bg-[color:var(--surface-blur)] backdrop-blur-md lg:hidden">
          {MOBILE_NAV.map((item) => {
            const active = isActive(item.href);
            const isMore = item.key === "more";
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  if (isMore) setDrawer(true);
                  else window.location.assign(item.href);
                }}
                className={cx(
                  "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10.5px] font-medium transition-colors",
                  active ? "text-brand-600" : "text-subtle",
                )}
              >
                <Icon name={item.icon} size={19} />
                {t(item.labelKey)}
              </button>
            );
          })}
        </nav>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />

      <Link href="/my-work" className="sr-only">
        {t("nav.myWork")}
      </Link>
    </div>
  );
}
