"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { createInvoiceAction, updateInvoiceAction, type ActionState } from "@/app/actions/sales";
import { Button, Card, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { useApp } from "@/components/providers";
import { LineItemsEditor, FormError, emptyLine, initialLines, type EditorLine, type EditorProduct, type EditorTaxCode } from "./line-items";

export type CustomerOption = { id: number; name: string; taxId: string | null; currency: string; paymentTermsDays: number };

export function InvoiceForm({
  customers,
  products,
  taxCodes,
  warehouses,
  currency,
  defaults,
}: {
  customers: CustomerOption[];
  products: EditorProduct[];
  taxCodes: EditorTaxCode[];
  warehouses: { id: number; name: string }[];
  currency: string;
  defaults?: Partial<{
    invoiceId: number;
    contactId: number;
    issueDate: string;
    dueDate: string;
    currency: string;
    notes: string;
    terms: string;
    warehouseId: number | null;
    lines: EditorLine[];
    status: string;
  }>;
}) {
  const { t } = useApp();
  const editing = Boolean(defaults?.invoiceId);
  const [state, formAction, pending] = useActionState<ActionState | undefined, FormData>(
    editing ? updateInvoiceAction : createInvoiceAction,
    undefined,
  );
  const [lines, setLines] = React.useState<EditorLine[]>(() =>
    initialLines(defaults?.lines?.length ? defaults.lines : [{ ...emptyLine(1200), description: "", qty: 1 }]),
  );
  const [contactId, setContactId] = React.useState(defaults?.contactId ? String(defaults.contactId) : "");
  const [issueDate, setIssueDate] = React.useState(defaults?.issueDate ?? new Date().toISOString().slice(0, 10));
  const customer = customers.find((entry) => entry.id === Number(contactId));

  React.useEffect(() => {
    if (customer && !editing) {
      const due = new Date(issueDate);
      due.setUTCDate(due.getUTCDate() + (customer.paymentTermsDays || 14));
      setIssueDate(issueDate);
      const dueInput = document.getElementById("dueDate") as HTMLInputElement | null;
      if (dueInput) dueInput.value = due.toISOString().slice(0, 10);
    }
  }, [customer, editing, issueDate]);

  return (
    <form action={formAction} className="space-y-3">
      {editing ? <input type="hidden" name="invoiceId" value={defaults?.invoiceId} /> : null}
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("common.customer")} required className="sm:col-span-2">
            <Select
              name="contactId"
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
              required
              disabled={editing}
            >
              <option value="">{t("common.selectPlaceholder")}</option>
              {customers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                  {entry.taxId ? ` · ${entry.taxId}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("common.date")} required>
            <Input name="issueDate" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required />
          </Field>
          <Field label={t("common.dueDate")} required>
            <Input id="dueDate" name="dueDate" type="date" defaultValue={defaults?.dueDate ?? issueDate} required />
          </Field>
          <Field label={t("common.currency")}>
            <Select name="currency" defaultValue={defaults?.currency ?? currency}>
              {["UZS", "USD", "EUR", "RUB"].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("inv.warehouse")} hint={t("sales.warehouseHint")}>
            <Select name="warehouseId" defaultValue={defaults?.warehouseId ? String(defaults.warehouseId) : ""}>
              <option value="">{t("inv.noStockImpact")}</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-[15px] font-semibold">{t("sales.lines")}</h2>
        <LineItemsEditor products={products} taxCodes={taxCodes} priceField="sellingPrice" currency={defaults?.currency ?? currency} value={lines} onChange={setLines} />
      </Card>

      <Card className="grid gap-4 p-5 lg:grid-cols-2">
        <Field label={t("common.notes")}>
          <Textarea name="notes" rows={3} defaultValue={defaults?.notes ?? ""} placeholder={t("sales.notesPlaceholder")} />
        </Field>
        <div className="space-y-4">
          <Field label={t("sales.terms")}>
            <Textarea name="terms" rows={2} defaultValue={defaults?.terms ?? ""} placeholder={t("sales.termsPlaceholder")} />
          </Field>
          {!editing ? (
            <Checkbox name="sendNow" value="1" label={t("sales.sendImmediately")} hint={t("sales.sendImmediatelyHint")} />
          ) : (
            <Checkbox name="sendNow" value="1" label={t("sales.saveAndSend")} hint={t("sales.saveAndSendHint")} />
          )}
        </div>
      </Card>

      <FormError message={state?.error} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/sales/invoices" className="focus-ring rounded-[12px] px-4 py-2 text-[13.5px] font-medium text-muted hover:surface-muted">
          {t("common.cancel")}
        </Link>
        <Button type="submit" variant="primary" loading={pending} icon={<Icon name="check" size={15} />}>
          {editing ? t("common.saveChanges") : t("sales.createInvoice")}
        </Button>
      </div>
    </form>
  );
}
