"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/components/providers";
import { Tabs } from "@/components/ui/primitives";

/** URL-driven status filter — server components read the same query string. */
export function StatusTabs({
  statuses,
  current,
  param = "status",
  counts,
  labels,
}: {
  statuses: string[];
  current: string;
  param?: string;
  counts?: Record<string, number>;
  labels?: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { t } = useApp();

  const change = (status: string) => {
    const next = new URLSearchParams(params.toString());
    if (status === "all") next.delete(param);
    else next.set(param, status);
    next.delete("page");
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <Tabs
      tabs={statuses.map((status) => ({
        id: status,
        label: labels?.[status] ?? (status === "all" ? t("common.all") : t(`status.${status}`)),
        count: counts?.[status],
      }))}
      active={current}
      onChange={change}
    />
  );
}
