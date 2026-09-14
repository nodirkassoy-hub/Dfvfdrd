import Link from "next/link";
import { requireContext } from "@/lib/auth/guard";
import { companySalesTotals, listInvoices } from "@/lib/services/sales";
import { listContacts } from "@/lib/services/contacts";
import { periodFromParams } from "@/lib/services/intelligence";
import { translate } from "@/lib/i18n";
import { money, plainPercent } from "@/lib/format";
import { Card, LinkButton, PageHeader, Tabs } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PeriodPicker } from "@/components/ui/period-picker";
import { StatusTabs } from "@/components/ui/status-tabs";

export const dynamic = "force-dynamic";

const STATUSES = ["all", "draft", "sent", "partially_paid", "paid", "overdue", "cancelled"];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await requireContext();
  const locale = context.locale;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const period = periodFromParams(context.company.id, params, locale);
  const status = typeof params.status === "string" ? params.status : "all";
  const customerId = typeof params.customer === "string" ? Number(params.customer) : undefined;

  const invoices = listInvoices(context.company.id, {
    status,
    contactId: customerId,
    from: period.from,
    to: period.to,
    search: typeof params.q === "string" ? params.q : undefined,
  });
  const totals = companySalesTotals(context.company.id);
  const customers = listContacts(context.company.id, "customer");

  const columns: Column[] = [
    { key: "number", label: t("sales.invoice"), kind: "link", href: "/sales/invoices/{id}", width: "150px" },
    { key: "customerName", label: t("common.customer") },
    { key: "issueDate", label: t("common.date"), kind: "date", hideOnMobile: true },
    { key: "dueDate", label: t("common.dueDate"), kind: "date" },
    { key: "status", label: t("common.status"), kind: "badge", translateBadge: true },
    { key: "total", label: t("common.total"), kind: "money", align: "right", currencyField: "currency", emphasis: true },
    { key: "amountDue", label: t("sales.amountDue"), kind: "money", align: "right", currencyField: "currency" },
  ];

  return (
    <>
      <PageHeader
        title={t("sales.invoices")}
        subtitle={t("sales.invoicesSubtitle")}
        actions={
          <>
            <PeriodPicker current={period.key} />
            <LinkButton href="/sales/invoices/new" variant="primary" icon={<Icon name="plus" size={15} />}>
              {t("sales.createInvoice")}
            </LinkButton>
          </>
        }
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { key: "invoiced", label: t("sales.invoiced"), value: totals?.invoiced ?? 0, tone: "text-[color:var(--text)]" },
          { key: "paid", label: t("sales.collected"), value: totals?.paid ?? 0, tone: "text-positive-600" },
          { key: "outstanding", label: t("sales.outstanding"), value: totals?.outstanding ?? 0, tone: "text-[color:var(--text)]" },
          { key: "overdue", label: t("sales.overdue"), value: totals?.overdue ?? 0, tone: "text-negative-600" },
        ].map((kpi) => (
          <Card key={kpi.key} className="p-4">
            <p className="text-[12.5px] text-muted">{kpi.label}</p>
            <p className={`num mt-1.5 text-[19px] font-semibold ${kpi.tone}`}>{money(kpi.value, context.currency, locale)}</p>
            {kpi.key === "paid" && totals?.invoiced ? (
              <p className="mt-1 text-[11.5px] text-subtle">
                {plainPercent((totals.paid / totals.invoiced) * 100)} {t("sales.collectionRate")}
              </p>
            ) : null}
          </Card>
        ))}
      </div>

      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <StatusTabs statuses={STATUSES} current={status} param="status" labels={{ all: t("common.all") }} />
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/sales/invoices?status=${status}&customer=`}
            className="focus-ring rounded-[10px] border border-[color:var(--border)] px-2.5 py-1.5 text-[12.5px] text-muted hover:surface-muted"
          >
            {t("sales.allCustomers")}
          </Link>
          {customers.slice(0, 4).map((customer) => (
            <Link
              key={customer.id}
              href={`/sales/invoices?status=${status}&customer=${customer.id}`}
              className={`focus-ring rounded-[10px] border px-2.5 py-1.5 text-[12.5px] ${
                customerId === customer.id ? "border-brand-300 bg-brand-50 text-brand-700" : "border-[color:var(--border)] text-muted hover:surface-muted"
              }`}
            >
              {customer.name}
            </Link>
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={invoices as unknown as Record<string, unknown>[]}
        rowHref="/sales/invoices/{id}"
        initialSort={{ key: "issueDate", dir: "desc" }}
        empty={{
          title: t("sales.noInvoices"),
          description: t("sales.noInvoicesHint"),
          action: (
            <LinkButton href="/sales/invoices/new" variant="primary" icon={<Icon name="plus" size={15} />}>
              {t("sales.createInvoice")}
            </LinkButton>
          ),
        }}
      />
    </>
  );
}
