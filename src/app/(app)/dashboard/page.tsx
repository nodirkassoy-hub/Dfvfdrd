import Link from "next/link";
import { requireContext } from "@/lib/auth/guard";
import { dashboardData, greetingKey } from "@/lib/services/dashboard";
import { periodFromParams } from "@/lib/services/intelligence";
import { agingBucket, formatDate, formatMonthShort, todayISO } from "@/lib/dates";
import { money, percent, qty, compactScale } from "@/lib/format";
import { translate } from "@/lib/i18n";
import { Badge, Card, CardHeader, EmptyState, LinkButton, ProgressBar, Tooltip } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { BarChart, CHART_COLORS, DonutChart, LineChart, ProgressRing } from "@/components/charts/charts";
import { PeriodPicker } from "@/components/ui/period-picker";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await requireContext();
  const locale = context.locale;
  const currency = context.currency;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const period = periodFromParams(context.company.id, params, locale);
  const data = dashboardData(context.company.id, period, currency);
  const today = todayISO();
  const fmt = (value: number, opts?: { compact?: boolean; signed?: boolean }) =>
    money(value, currency, locale, { compact: opts?.compact, signed: opts?.signed });

  const aging = data.aging.reduce(
    (acc, row) => {
      acc.current += row.current;
      acc.d1_30 += row.d1_30;
      acc.d31_60 += row.d31_60;
      acc.d61_90 += row.d61_90;
      acc.d90_plus += row.d90_plus;
      acc.total += row.total;
      return acc;
    },
    { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 },
  );

  const forecastSeries = [
    {
      key: "balance",
      name: t("dash.forecastSeries"),
      color: CHART_COLORS.cash,
      points: data.forecast.points.map((point) => ({ label: formatDate(point.date, locale), value: point.balance })),
      type: "area" as const,
    },
  ];

  const outstandingTotal = data.outstandingInvoices.reduce((sum, invoice) => sum + invoice.amountDue, 0);
  const upcomingTotal = data.upcomingPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const severityTone = (severity: string) =>
    severity === "critical" || severity === "high" ? ("negative" as const) : severity === "medium" ? ("warning" as const) : ("info" as const);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-semibold tracking-[-0.02em] lg:text-[26px]">
            {t(greetingKey())}, {context.user.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-[13.5px] text-muted">
            {context.company.name} · {period.key} · {t("dash.ledgerSource")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker current={period.key} />
          <LinkButton href="/sales/invoices/new" variant="secondary" icon={<Icon name="plus" size={15} />}>
            {t("dash.newInvoice")}
          </LinkButton>
          <LinkButton href="/purchases/expenses/new" variant="secondary" icon={<Icon name="receipt" size={15} />}>
            {t("dash.newExpense")}
          </LinkButton>
          <LinkButton href="/ai-center/accountant" variant="primary" icon={<Icon name="sparkles" size={15} />}>
            {t("dash.askAi")}
          </LinkButton>
        </div>
      </div>

      {context.company.is_demo === 1 ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-[13px] border border-warning-200 bg-warning-50 px-4 py-2.5 text-[12.5px] text-warning-800">
          <Icon name="flask" size={15} className="mt-0.5 shrink-0" />
          <p>{t("dash.demoBanner")}</p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.kpis.map((kpi) => {
          const good = kpi.changePct === null ? null : kpi.goodDirection === "up" ? kpi.changePct >= 0 : kpi.changePct <= 0;
          const drillHref = `${kpi.drill.href}${kpi.drill.href.includes("?") ? "&" : "?"}preset=${period.preset}&from=${period.from}&to=${period.to}`;
          return (
            <Link key={kpi.key} href={drillHref} className="card focus-ring group p-4 transition-shadow hover:shadow-[var(--shadow-raised)]">
              <div className="flex items-start justify-between gap-3">
                <span className="text-[12.5px] font-medium text-muted">{t(kpi.labelKey)}</span>
                <Icon name="arrowUpRight" size={14} className="text-subtle transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </div>
              <p className="num mt-2 text-[24px] font-semibold tracking-[-0.02em]">{fmt(kpi.value)}</p>
              <div className="mt-2 flex items-center gap-2">
                {kpi.changePct === null ? (
                  <span className="text-[11.5px] text-subtle">{t("dash.noComparison")}</span>
                ) : (
                  <span
                    className={`num inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11.5px] font-medium ${
                      good ? "bg-positive-50 text-positive-600" : "bg-negative-50 text-negative-600"
                    }`}
                  >
                    <Icon name={kpi.changePct >= 0 ? "trendUp" : "trendDown"} size={12} />
                    {percent(kpi.changePct)}
                  </span>
                )}
                <span className="truncate text-[11.5px] text-subtle">{t("dash.vsPrevious")}</span>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title={t("dash.revenueVsExpenses")}
            subtitle={t("dash.revenueVsExpensesHint")}
            action={
              <Link href="/reports/profit-loss" className="focus-ring rounded-[9px] px-2 py-1 text-[12.5px] font-medium text-brand-600 hover:bg-brand-50">
                {t("dash.viewReport")}
              </Link>
            }
          />
          <div className="px-2 pb-3">
            {data.series.length ? (
              <BarChart
                data={data.series.map((point) => ({
                  label: formatMonthShort(point.month, locale),
                  value: point.revenue,
                  compare: point.expenses + point.cogs,
                }))}
                showCompare
                height={252}
                format={{ kind: "money", currency, locale, compact: true }}
              />
            ) : (
              <EmptyState compact title={t("dash.noData")} description={t("dash.noDataHint")} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("dash.expenseBreakdown")} subtitle={period.key} />
          <div className="px-5 pb-5 pt-1">
            {data.expenseBreakdown.length ? (
              <DonutChart
                data={data.expenseBreakdown.map((row) => ({ label: row.label, value: row.amount }))}
                centerValue={compactScale(data.expenseBreakdown.reduce((sum, row) => sum + row.amount, 0), currency, locale)}
                centerLabel={t("dash.expenses")}
                format={{ kind: "money", currency, locale, compact: true }}
              />
            ) : (
              <EmptyState compact title={t("dash.noExpenses")} description={t("dash.noExpensesHint")} />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title={t("dash.cashFlowForecast")}
            subtitle={`${fmt(data.forecast.startBalance, { compact: true })} → ${fmt(data.forecast.endBalance, { compact: true })}`}
            action={
              <Link href="/reports/cash-flow" className="focus-ring rounded-[9px] px-2 py-1 text-[12.5px] font-medium text-brand-600 hover:bg-brand-50">
                {t("dash.viewReport")}
              </Link>
            }
          />
          <div className="px-2 pb-2">
            {data.forecast.points.length > 1 ? (
              <LineChart series={forecastSeries} height={228} format={{ kind: "money", currency, locale, compact: true }} />
            ) : (
              <EmptyState compact title={t("dash.noForecast")} description={t("dash.noForecastHint")} />
            )}
          </div>
          <p className="mx-5 mb-4 text-[11px] leading-relaxed text-subtle">{t("dash.cashFlowHint")}</p>
          {data.forecast.shortages.length ? (
            <p className="mx-5 mb-4 flex items-start gap-2 rounded-[11px] bg-negative-50 px-3 py-2 text-[12px] text-negative-600">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              {t("dash.shortageWarning", {
                count: data.forecast.shortages.length,
                balance: fmt(data.forecast.minBalance),
                date: formatDate(data.forecast.minDate, locale),
              })}
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title={t("dash.healthScore")}
            subtitle={data.health.band}
            action={
              <Link href="/ai-center/cfo" className="focus-ring rounded-[9px] px-2 py-1 text-[12.5px] font-medium text-brand-600 hover:bg-brand-50">
                {t("dash.openCfo")}
              </Link>
            }
          />
          <div className="flex items-center gap-5 px-5 pb-4">
            <ProgressRing value={data.health.score} size={96} thickness={9} label="/100" />
            <div className="min-w-0 flex-1 space-y-2.5">
              {data.health.factors.slice(0, 4).map((factor) => (
                <div key={factor.key}>
                  <div className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="truncate text-muted">{factor.label}</span>
                    <span className="num font-medium">{Math.round(factor.score)}</span>
                  </div>
                  <ProgressBar value={factor.score} tone={factor.score >= 75 ? "positive" : factor.score >= 50 ? "brand" : "warning"} />
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-[color:var(--border)] px-5 py-3">
            <div className="grid grid-cols-2 gap-3 text-[12.5px]">
              <div>
                <p className="text-subtle">{t("dash.inflow90")}</p>
                <p className="num font-medium text-positive-600">{fmt(data.forecast.inflowTotal, { compact: true })}</p>
              </div>
              <div>
                <p className="text-subtle">{t("dash.outflow90")}</p>
                <p className="num font-medium text-negative-600">{fmt(data.forecast.outflowTotal, { compact: true })}</p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader
            title={t("dash.outstandingInvoices")}
            subtitle={`${data.outstandingInvoices.length} · ${fmt(outstandingTotal, { compact: true })}`}
            action={
              <Link href="/sales/receivables" className="focus-ring rounded-[9px] px-2 py-1 text-[12.5px] font-medium text-brand-600 hover:bg-brand-50">
                {t("common.viewAll")}
              </Link>
            }
          />
          {data.outstandingInvoices.length ? (
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-y border-[color:var(--border)] text-left text-[11.5px] uppercase tracking-wide text-subtle">
                    <th className="px-5 py-2 font-medium">{t("sales.invoice")}</th>
                    <th className="px-3 py-2 font-medium">{t("common.dueDate")}</th>
                    <th className="px-5 py-2 text-right font-medium">{t("sales.amountDue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outstandingInvoices.map((invoice) => {
                    const overdue = agingBucket(invoice.dueDate, today) !== "current";
                    return (
                      <tr key={invoice.id} className="border-b border-[color:var(--border)] last:border-0 hover:surface-muted">
                        <td className="px-5 py-2.5">
                          <Link href={`/sales/invoices/${invoice.id}`} className="num font-medium hover:text-brand-600">
                            {invoice.number}
                          </Link>
                          <p className="truncate text-[11.5px] text-subtle">{invoice.customerName}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="num block text-[12.5px]">{formatDate(invoice.dueDate, locale)}</span>
                          {overdue ? (
                            <Badge tone="warning" className="mt-0.5">
                              {t("sales.overdueDays", { days: invoice.daysOverdue })}
                            </Badge>
                          ) : (
                            <Badge tone="info" className="mt-0.5">
                              {t("status.pending")}
                            </Badge>
                          )}
                        </td>
                        <td className="num px-5 py-2.5 text-right font-medium">{fmt(invoice.amountDue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState compact icon={<Icon name="check" size={20} />} title={t("dash.noInvoices")} description={t("dash.noInvoicesHint")} />
          )}
        </Card>

        <div className="grid gap-3">
          <Card>
            <CardHeader title={t("dash.upcomingPayments")} subtitle={`${fmt(upcomingTotal, { compact: true })} · ${data.upcomingPayments.length}`} />
            {data.upcomingPayments.length ? (
              <ul className="divide-y divide-[color:var(--border)]">
                {data.upcomingPayments.map((payment, index) => (
                  <li key={`${payment.href}-${index}`}>
                    <Link href={payment.href} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:surface-muted">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{payment.label}</span>
                        <span className="num block text-[11.5px] text-subtle">{formatDate(payment.date, locale)}</span>
                      </span>
                      <span className="num shrink-0 text-[13px] font-medium">{fmt(payment.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={<Icon name="check" size={20} />} title={t("dash.noUpcoming")} />
            )}
          </Card>

          <Card>
            <CardHeader title={t("dash.agingSummary")} subtitle={fmt(aging.total, { compact: true })} />
            <div className="space-y-2.5 px-5 pb-5">
              {(
                [
                  ["current", t("rep.agingCurrent"), aging.current, "positive"],
                  ["1_30", t("rep.aging1_30"), aging.d1_30, "brand"],
                  ["31_60", t("rep.aging31_60"), aging.d31_60, "warning"],
                  ["61_90", t("rep.aging61_90"), aging.d61_90, "warning"],
                  ["90_plus", t("rep.aging90Plus"), aging.d90_plus, "negative"],
                ] as const
              ).map(([key, label, value, tone]) => (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="text-muted">{label}</span>
                    <span className="num font-medium">{fmt(value)}</span>
                  </div>
                  <ProgressBar value={aging.total ? (value / aging.total) * 100 : 0} tone={tone} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader
            title={t("xato.title")}
            subtitle={
              data.alertSummary.open
                ? t("dash.xatoSummary", { count: data.alertSummary.open, critical: data.alertSummary.critical })
                : t("dash.noAlerts")
            }
            icon={<Icon name="radar" size={17} />}
            action={
              <Link href="/ai-center/xato-radar" className="focus-ring rounded-[9px] px-2 py-1 text-[12.5px] font-medium text-brand-600 hover:bg-brand-50">
                {t("common.viewAll")}
              </Link>
            }
          />
          {data.alerts.length ? (
            <ul className="divide-y divide-[color:var(--border)]">
              {data.alerts.map((alert) => (
                <li key={alert.id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[color:var(--surface-muted)]">
                    <Icon name="alert" size={14} className="text-warning-600" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[13px] font-medium">{alert.title}</p>
                      <Badge tone={severityTone(alert.severity)}>{t(`status.${alert.severity}`)}</Badge>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-muted">{alert.whatHappened}</p>
                    <p className="mt-1 text-[11.5px] text-subtle">
                      {t("xato.impact")}: <span className="num">{fmt(alert.impactAmount)}</span> · {Math.round(alert.confidenceBp / 100)}%{" "}
                      {t("xato.confidence")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={<Icon name="shield" size={20} />} title={t("dash.noAlerts")} description={t("dash.noAlertsHint")} />
          )}
        </Card>

        <div className="grid gap-3">
          <Card>
            <CardHeader
              title={t("dash.recentActivity")}
              action={
                <Link href="/accounting/transactions" className="focus-ring rounded-[9px] px-2 py-1 text-[12.5px] font-medium text-brand-600 hover:bg-brand-50">
                  {t("nav.journalEntries")}
                </Link>
              }
            />
            {data.recentEntries.length ? (
              <ul className="divide-y divide-[color:var(--border)]">
                {data.recentEntries.map((entry) => (
                  <li key={entry.id}>
                    <Link href={`/accounting/journal-entries/${entry.id}`} className="block px-5 py-2.5 hover:surface-muted">
                      <div className="flex items-center justify-between gap-3">
                        <span className="num text-[12.5px] font-medium">{entry.number}</span>
                        <span className="num text-[12.5px]">{fmt(entry.amount)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-muted">{entry.memo ?? "—"}</p>
                      <p className="mt-0.5 truncate text-[11.5px] text-subtle">
                        {t("gl.debitShort")} {entry.debitAccount} · {t("gl.creditShort")} {entry.creditAccount}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact title={t("dash.noRecent")} description={t("dash.noRecentHint")} />
            )}
          </Card>

          <Card>
            <CardHeader
              title={t("dash.lowStock")}
              subtitle={`${data.counts.products} ${t("inv.products").toLowerCase()}`}
              action={
                <Link href="/inventory/stock" className="focus-ring rounded-[9px] px-2 py-1 text-[12.5px] font-medium text-brand-600 hover:bg-brand-50">
                  {t("nav.inventory")}
                </Link>
              }
            />
            {data.lowStock.length ? (
              <ul className="divide-y divide-[color:var(--border)]">
                {data.lowStock.map((product) => (
                  <li key={product.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{product.name}</span>
                      <span className="num block text-[11.5px] text-subtle">{product.sku}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-[13px] font-medium text-warning-700">
                        {qty(product.qtyMilli, locale)} {product.unit}
                      </span>
                      <span className="num block text-[11px] text-subtle">
                        {t("inv.min")} {qty(product.minStockMilli, locale)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={<Icon name="box" size={20} />} title={t("dash.noLowStock")} description={t("dash.noLowStockHint")} />
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-2 text-[12.5px]">
            <Icon
              name={data.integrity.balanced ? "shield" : "alert"}
              size={15}
              className={data.integrity.balanced ? "text-positive-600" : "text-negative-600"}
            />
            <span className={data.integrity.balanced ? "text-positive-700" : "text-negative-700"}>
              {data.integrity.balanced
                ? t("common.ledgerBalanced")
                : t("dash.integrityFail", { amount: fmt(data.integrity.difference) })}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-subtle">
            <Tooltip label={t("dash.entriesChecked")}>
              <span className="num">{data.integrity.entries}</span>
            </Tooltip>
            <span>·</span>
            <Link href="/accounting/trial-balance" className="hover:text-brand-600">
              {t("nav.trialBalance")}
            </Link>
            <span>·</span>
            <Link href="/reports/balance-sheet" className="hover:text-brand-600">
              {t("rep.balanceSheet")}
            </Link>
            <span>·</span>
            <Link href="/accounting/journal-entries" className="hover:text-brand-600">
              {t("nav.journalEntries")}
            </Link>
          </div>
        </div>
      </Card>
    </>
  );
}
