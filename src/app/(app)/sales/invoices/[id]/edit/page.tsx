import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/guard";
import { getInvoiceDetail } from "@/lib/services/sales";
import { listContacts } from "@/lib/services/contacts";
import { listProducts } from "@/lib/services/inventory";
import { all } from "@/lib/db";
import { translate } from "@/lib/i18n";
import { money } from "@/lib/format";
import { PageHeader } from "@/components/ui/primitives";
import { InvoiceForm } from "@/components/forms/invoice-form";

import type { EditorLine } from "@/components/forms/line-items";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireContext();
  const t = (key: string) => translate(context.locale, key);
  const detail = getInvoiceDetail(context.company.id, Number(id));
  if (!detail) notFound();
  const invoice = detail.invoice as Record<string, unknown>;
  const status = String(invoice.status);
  if (!["draft", "sent"].includes(status)) redirect(`/sales/invoices/${id}`);

  const currency = String(invoice.currency);
  const lines: EditorLine[] = (detail.lines as Record<string, unknown>[]).map((line, index) => ({
    key: `existing-${index}`,
    productId: line.product_id ? Number(line.product_id) : null,
    description: String(line.description ?? ""),
    qty: Number(line.qty_milli) / 1000,
    unitPrice: Number(line.unit_price),
    discount: Number(line.discount ?? 0),
    taxRateBp: Number(line.tax_rate_bp ?? 0),
  }));

  const customers = listContacts(context.company.id, "customer");
  const products = listProducts(context.company.id);
  const taxCodes = all<{ id: number; name: string; rateBp: number }>(
    "SELECT id, name, rate_bp AS rateBp FROM tax_codes WHERE company_id = ? AND is_active = 1 ORDER BY rate_bp DESC",
    [context.company.id],
  );
  const warehouses = all<{ id: number; name: string }>("SELECT id, name FROM warehouses WHERE company_id = ? ORDER BY is_default DESC", [context.company.id]);

  return (
    <>
      <PageHeader title={`${t("common.edit")} · ${String(invoice.number)}`} subtitle={t("sales.editHint")} />
      <InvoiceForm
        customers={customers.map((contact) => ({
          id: contact.id,
          name: contact.name,
          taxId: contact.taxId ?? null,
          currency: contact.currency ?? currency,
          paymentTermsDays: contact.paymentTermsDays ?? 14,
        }))}
        products={products.map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          sellingPrice: product.selling_price,
          purchasePrice: product.purchase_price,
          type: product.type,
          isTracked: product.is_tracked,
        }))}
        taxCodes={taxCodes}
        warehouses={warehouses}
        currency={currency}
        defaults={{
          invoiceId: Number(invoice.id),
          contactId: Number(invoice.contact_id),
          issueDate: String(invoice.issue_date),
          dueDate: String(invoice.due_date),
          currency,
          notes: String(invoice.notes ?? ""),
          terms: String(invoice.terms ?? ""),
          warehouseId: null,
          lines,
          status,
        }}
      />
      <p className="mt-3 text-[11.5px] text-subtle">
        {t("sales.editPostedHint")} <span className="num">{money(Number(invoice.total), currency, context.locale)}</span>
      </p>
    </>
  );
}
