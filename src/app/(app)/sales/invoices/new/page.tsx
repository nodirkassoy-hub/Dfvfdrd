import { requireContext } from "@/lib/auth/guard";
import { listContacts } from "@/lib/services/contacts";
import { listProducts } from "@/lib/services/inventory";
import { all } from "@/lib/db";
import { translate } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/primitives";
import { InvoiceForm } from "@/components/forms/invoice-form";
import { todayISO, addDays } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const context = await requireContext();
  const t = (key: string) => translate(context.locale, key);
  const customers = listContacts(context.company.id, "customer").filter((contact) => contact.kind === "customer" || contact.kind === "both");
  const products = listProducts(context.company.id);
  const taxCodes = all<{ id: number; name: string; rateBp: number }>(
    "SELECT id, name, rate_bp AS rateBp FROM tax_codes WHERE company_id = ? AND is_active = 1 ORDER BY rate_bp DESC",
    [context.company.id],
  );
  const warehouses = all<{ id: number; name: string }>("SELECT id, name FROM warehouses WHERE company_id = ? ORDER BY is_default DESC", [context.company.id]);

  return (
    <>
      <PageHeader title={t("sales.createInvoice")} subtitle={t("sales.createInvoiceHint")} />
      <InvoiceForm
        customers={customers.map((contact) => ({
          id: contact.id,
          name: contact.name,
          taxId: contact.taxId ?? null,
          currency: contact.currency ?? context.currency,
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
        currency={context.currency}
        defaults={{ dueDate: addDays(todayISO(), 14), issueDate: todayISO(), currency: context.currency }}
      />
    </>
  );
}
