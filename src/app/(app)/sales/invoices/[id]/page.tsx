import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/guard";
import { getInvoiceDetail } from "@/lib/services/sales";
import { listBankAccounts } from "@/lib/services/banking";
import { can } from "@/lib/auth/permissions";
import { translate } from "@/lib/i18n";
import { money, qty } from "@/lib/format";
import { formatDate } from "@/lib/dates";
import { Badge, Card, CardHeader, InfoRow, PageHeader, STATUS_TONES } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { InvoiceActions } from "@/components/sales/invoice-actions";

export const dynamic = "force-dynamic";

type InvoiceRecord = Record<string, unknown>;

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireContext();
  const locale = context.locale;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const detail = getInvoiceDetail(context.company.id, Number(id));
  if (!detail) notFound();

  const invoice = detail.invoice as InvoiceRecord;
  const lines = detail.lines as (Record<string, unknown> & { id: number })[];
  const payments = detail.payments as (Record<string, unknown> & { id: number })[];
  const currency = String(invoice.currency);
  const status = String(invoice.status);
  const total = Number(invoice.total);
  const amountPaid = Number(invoice.amount_paid);
  const amountDue = total - amountPaid;
  const bankAccounts = listBankAccounts(context.company.id);
  const canApprove = can(context.permissions, "approve");
  const canDelete = can(context.permissions, "delete");

  return (
    <>
      <PageHeader
        breadcrumb={
          <span className="flex items-center gap-1.5">
            <Link href="/sales/invoices" className="hover:text-brand-600">
              {t("sales.invoices")}
            </Link>
            <Icon name="chevronRight" size={12} />
            <span className="num">{String(invoice.number)}</span>
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="num">{String(invoice.number)}</span>
            <Badge tone={STATUS_TONES[status] ?? "neutral"}>{t(`status.${status}`)}</Badge>
          </span>
        }
        subtitle={`${String(invoice.customerName)} · ${t("sales.issued")} ${formatDate(String(invoice.issue_date), locale)} · ${t("common.dueDate")} ${formatDate(String(invoice.due_date), locale)}`}
        actions={
          <InvoiceActions
            invoiceId={Number(invoice.id)}
            status={status}
            total={total}
            amountPaid={amountPaid}
            amountDue={amountDue}
            currency={currency}
            bankAccounts={bankAccounts.map((account) => ({ id: account.id, name: account.name, currency: account.currency }))}
            canApprove={canApprove}
            canDelete={canDelete}
          />
        }
      />

      <div className="grid gap-3 lg:grid-cols-[1.7fr_1fr]">
        <Card>
          <CardHeader
            title={t("sales.invoiceBody")}
            subtitle={`${lines.length} ${t("sales.lines").toLowerCase()}`}
            action={<span className="text-[12px] text-subtle">{t("common.page")} 1/1</span>}
          />
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="border-y border-[color:var(--border)] text-left text-[11.5px] uppercase tracking-wide text-subtle">
                  <th className="px-5 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">{t("common.description")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("common.quantity")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("common.unitPrice")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("common.tax")}</th>
                  <th className="px-5 py-2 text-right font-medium">{t("common.total")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.id} className="border-b border-[color:var(--border)] last:border-0">
                    <td className="num px-5 py-2.5 text-subtle">{index + 1}</td>
                    <td className="px-3 py-2.5">
                      <span className="block font-medium">{String(line.description)}</span>
                      <span className="block text-[11.5px] text-subtle">
                        {line.sku ? `${String(line.sku)} · ` : ""}
                        {line.accountCode ? `${String(line.accountCode)} ${String(line.accountName ?? "")}` : t("sales.noAccount")}
                      </span>
                    </td>
                    <td className="num px-3 py-2.5 text-right">{qty(Number(line.qty_milli), locale)}</td>
                    <td className="num px-3 py-2.5 text-right">{money(Number(line.unit_price), currency, locale)}</td>
                    <td className="num px-3 py-2.5 text-right">
                      {(Number(line.tax_rate_bp) / 100).toFixed(0)}% · {money(Number(line.tax_amount), currency, locale)}
                    </td>
                    <td className="num px-5 py-2.5 text-right font-medium">{money(Number(line.line_total), currency, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col items-end gap-1 border-t border-[color:var(--border)] px-5 py-4 text-[13px]">
            <div className="flex w-full max-w-[320px] items-center justify-between">
              <span className="text-muted">{t("common.subtotal")}</span>
              <span className="num">{money(Number(invoice.subtotal), currency, locale)}</span>
            </div>
            {Number(invoice.discount_total) > 0 ? (
              <div className="flex w-full max-w-[320px] items-center justify-between">
                <span className="text-muted">{t("common.discount")}</span>
                <span className="num text-negative-600">−{money(Number(invoice.discount_total), currency, locale)}</span>
              </div>
            ) : null}
            <div className="flex w-full max-w-[320px] items-center justify-between">
              <span className="text-muted">{t("common.tax")}</span>
              <span className="num">{money(Number(invoice.tax_total), currency, locale)}</span>
            </div>
            <div className="flex w-full max-w-[320px] items-center justify-between border-t border-[color:var(--border)] pt-1.5 text-[15px] font-semibold">
              <span>{t("common.total")}</span>
              <span className="num">{money(total, currency, locale)}</span>
            </div>
            {amountPaid > 0 ? (
              <>
                <div className="flex w-full max-w-[320px] items-center justify-between text-positive-600">
                  <span>{t("sales.paidAmount")}</span>
                  <span className="num">{money(amountPaid, currency, locale)}</span>
                </div>
                <div className="flex w-full max-w-[320px] items-center justify-between font-semibold">
                  <span>{t("sales.amountDue")}</span>
                  <span className="num">{money(amountDue, currency, locale)}</span>
                </div>
              </>
            ) : null}
          </div>

          {invoice.notes ? (
            <div className="border-t border-[color:var(--border)] px-5 py-4">
              <p className="text-[11.5px] uppercase tracking-wide text-subtle">{t("common.notes")}</p>
              <p className="mt-1 whitespace-pre-wrap text-[13px]">{String(invoice.notes)}</p>
            </div>
          ) : null}
        </Card>

        <div className="grid gap-3">
          <Card>
            <CardHeader title={t("common.customer")} />
            <div className="space-y-2 px-5 pb-5">
              <InfoRow label={t("common.customer")} value={String(invoice.customerName)} />
              {invoice.customerTaxId ? <InfoRow label={t("settings.taxId")} value={String(invoice.customerTaxId)} mono /> : null}
              {invoice.customerAddress ? <InfoRow label={t("settings.address")} value={String(invoice.customerAddress)} /> : null}
              {invoice.customerEmail ? <InfoRow label={t("settings.email")} value={String(invoice.customerEmail)} /> : null}
              {invoice.customerPhone ? <InfoRow label={t("settings.phone")} value={String(invoice.customerPhone)} /> : null}
              <InfoRow label={t("common.currency")} value={currency} />
              {invoice.reference ? <InfoRow label={t("common.reference")} value={String(invoice.reference)} mono /> : null}
            </div>
          </Card>

          <Card>
            <CardHeader title={t("sales.ledgerTrace")} subtitle={t("sales.ledgerTraceHint")} />
            <div className="space-y-2 px-5 pb-5">
              {invoice.entryId ? (
                <>
                  <InfoRow
                    label={t("sales.journalEntry")}
                    value={
                      <Link href={`/accounting/journal-entries/${String(invoice.entryId)}`} className="num text-brand-600 hover:underline">
                        {String(invoice.entryNumber)}
                      </Link>
                    }
                  />
                  <InfoRow label={t("common.date")} value={formatDate(String(invoice.entryDate), locale)} />
                  <InfoRow label={t("dash.receivable")} value={money(amountDue, currency, locale)} mono />
                  <InfoRow label={t("dash.revenue")} value={money(Number(invoice.subtotal) - Number(invoice.discount_total), currency, locale)} mono />
                  <InfoRow label={t("common.tax")} value={money(Number(invoice.tax_total), currency, locale)} mono />
                </>
              ) : (
                <p className="text-[12.5px] text-muted">{t("sales.notPostedYet")}</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title={t("sales.payments")} subtitle={`${payments.length}`} />
            {payments.length ? (
              <ul className="divide-y divide-[color:var(--border)]">
                {payments.map((payment) => (
                  <li key={payment.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="min-w-0">
                      <span className="num block text-[13px] font-medium">{String(payment.number)}</span>
                      <span className="block text-[11.5px] text-subtle">
                        {formatDate(String(payment.date), locale)} · {String(payment.method ?? "bank_transfer")}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-[13px] font-medium text-positive-600">{money(Number(payment.amount), currency, locale)}</span>
                      {payment.journalEntryId ? (
                        <Link href={`/accounting/journal-entries/${String(payment.journalEntryId)}`} className="text-[11px] text-brand-600 hover:underline">
                          {String(payment.entryNumber ?? t("sales.journalEntry"))}
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 pb-5 text-[12.5px] text-muted">{t("sales.noPayments")}</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
