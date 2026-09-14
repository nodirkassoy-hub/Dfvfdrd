"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { cx } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import { PERIOD_PRESETS, formatDate, type PeriodPreset } from "@/lib/dates";

export function PeriodPicker({ current, compact }: { current: string; compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { t, locale } = useApp();
  const [open, setOpen] = React.useState(false);
  const [custom, setCustom] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const apply = React.useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      next.delete("page");
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  React.useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="focus-ring flex h-9 items-center gap-2 rounded-[11px] border border-[color:var(--border)] surface px-3 text-[13px] font-medium"
      >
        <Icon name="calendar" size={15} className="text-subtle" />
        <span className="max-w-[190px] truncate">{current}</span>
        <Icon name="chevronDown" size={13} className="text-subtle" />
      </button>
      {open ? (
        <div className="animate-scale-in absolute right-0 top-[calc(100%+8px)] z-40 w-[268px] rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface)] p-1.5 shadow-[var(--shadow-pop)]">
          {PERIOD_PRESETS.filter((preset) => preset !== "custom").map((preset: PeriodPreset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                apply({ preset, from: "", to: "" });
                setOpen(false);
                setCustom(false);
              }}
              className={cx(
                "flex w-full items-center justify-between rounded-[9px] px-2.5 py-1.5 text-left text-[13px] hover:surface-muted",
                params.get("preset") === preset || (!params.get("preset") && preset === "this_month") ? "text-brand-600" : "",
              )}
            >
              {t(`acc.preset_${preset}`)}
              {params.get("preset") === preset ? <Icon name="check" size={14} /> : null}
            </button>
          ))}
          <div className="mt-1 border-t border-[color:var(--border)] pt-1">
            <button
              type="button"
              onClick={() => setCustom((value) => !value)}
              className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-[13px] hover:surface-muted"
            >
              <Icon name="clock" size={14} />
              {t("acc.customRange")}
            </button>
            {custom || (from && to) ? (
              <div className={cx("grid gap-2 px-1.5 pb-1.5", compact ? "" : "sm:grid-cols-2")}>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-subtle">{t("common.from")}</span>
                  <input
                    type="date"
                    defaultValue={from}
                    onChange={(event) => apply({ preset: "custom", from: event.target.value })}
                    className="focus-ring h-8 w-full rounded-[9px] border border-[color:var(--border)] surface-muted px-2 text-[12.5px]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-subtle">{t("common.to")}</span>
                  <input
                    type="date"
                    defaultValue={to}
                    onChange={(event) => apply({ preset: "custom", to: event.target.value })}
                    className="focus-ring h-8 w-full rounded-[9px] border border-[color:var(--border)] surface-muted px-2 text-[12.5px]"
                  />
                </label>
                <p className="text-[11px] text-subtle sm:col-span-2">
                  {t("common.today")}: {formatDate(new Date().toISOString().slice(0, 10), locale)}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
