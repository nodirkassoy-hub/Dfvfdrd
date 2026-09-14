"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  cancelInvoiceAction,
  deleteDraftInvoiceAction,
  duplicateInvoiceAction,
  recordInvoicePaymentAction,
  sendInvoiceAction,
  type ActionState,
} from "@/app/actions/sales";
import { Button, ConfirmDialog, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { useApp } from "@/components/providers";
import { money } from "@/lib/format";
import { FormError } from "@/components/forms/line-items";

export function InvoiceActions({
  invoiceId,
  status,
  total,
  amountPaid,
  amountDue,
  currency,
  bankAccounts,
  canApprove,
  canDelete,
}: {
  invoiceId: number;
  status: string;
  total: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  bankAccounts: { id: number; name: string; currency: string }[];
  canApprove: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { t, locale } = useApp();
  const { toast } = useToast();
  const [paymentOpen, setPaymentOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [payState, payAction, payPending] = React.useActionState<ActionState | undefined, FormData>(recordInvoicePaymentAction, undefined);

  React.useEffect(() => {
    if (payState?.ok) {
      toast({ title: t("sales.paymentRecorded"), description: t("sales.paymentRecordedHint"), tone: "success" });
      setPaymentOpen(false);
      router.refresh();
    } else if (payState?.error) {
      setError(payState.error);
    }
  }, [payState, router, t, toast]);

  const run = async (action: (form: FormData) => Promise<ActionState>, successMessage: string) => {
    setPending(true);
    setError(undefined);
    const form = new FormData();
    form.set("invoiceId", String(invoiceId));
    const result = await action(form);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      toast({ title: t("common.error"), description: result.error, tone: "error" });
      return;
    }
    toast({ title: successMessage, tone: "success" });
    if (action === duplicateInvoiceAction && result.id) {
      router.push(`/sales/invoices/${result.id}`);
      return;
    }
    router.refresh();
  };

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      {status === "draft" && canApprove ? (
        <Button variant="primary" icon={<Icon name="check" size={15} />} loading={pending} onClick={() => run(sendInvoiceAction, t("sales.invoicePosted"))}>
          {t("sales.postToLedger")}
        </Button>
      ) : null}
      {["sent", "partially_paid", "overdue"].includes(status) && canApprove ? (
        <Button variant="primary" icon={<Icon name="wallet" size={15} />} onClick={() => setPaymentOpen(true)}>
          {t("sales.recordPayment")}
        </Button>
      ) : null}
      <Button variant="secondary" icon={<Icon name="print" size={15} />} onClick={() => window.print()}>
        {t("common.print")}
      </Button>
      <Button variant="secondary" icon={<Icon name="duplicate" size={15} />} loading={pending} onClick={() => run(duplicateInvoiceAction, t("sales.invoiceDuplicated"))}>
        {t("common.duplicate")}
      </Button>
      {!["cancelled", "paid"].includes(status) && canApprove ? (
        <Button variant="ghost" onClick={() => setCancelOpen(true)}>
          {t("sales.cancelInvoice")}
        </Button>
      ) : null}
      {status === "draft" && canDelete ? (
        <Button variant="ghost" icon={<Icon name="trash" size={15} />} onClick={() => setDeleteOpen(true)}>
          {t("common.delete")}
        </Button>
      ) : null}
      {error ? <FormError message={error} /> : null}

      <Modal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        title={t("sales.recordPayment")}
        description={t("sales.paymentHint", { amount: money(amountDue, currency, locale) })}
        size="sm"
      >
        <form action={payAction} className="space-y-4">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <Field label={t("common.amount")} required>
            <Input name="amount" type="number" step="0.01" defaultValue={amountDue} required className="num" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("common.date")} required>
              <Input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
            </Field>
            <Field label={t("bank.account")} required>
              <Select name="bankAccountId" required defaultValue={bankAccounts[0]?.id ?? ""}>
                {bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.currency}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("bank.method")}>
              <Select name="method" defaultValue="bank_transfer">
                <option value="bank_transfer">{t("bank.methodBank")}</option>
                <option value="cash">{t("bank.methodCash")}</option>
                <option value="card">{t("bank.methodCard")}</option>
              </Select>
            </Field>
            <Field label={t("common.reference")}>
              <Input name="reference" placeholder="PMT-000123" />
            </Field>
          </div>
          <Field label={t("common.notes")}>
            <Textarea name="notes" rows={2} />
          </Field>
          <p className="text-[11.5px] text-subtle">
            {t("sales.paymentLedgerHint", { paid: money(amountPaid, currency, locale), total: money(total, currency, locale) })}
          </p>
          {payState?.error ? <FormError message={payState.error} /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setPaymentOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={payPending}>
              {t("sales.recordPayment")}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={cancelOpen}
        title={t("sales.cancelInvoice")}
        description={t("sales.cancelInvoiceHint")}
        confirmLabel={t("sales.cancelInvoice")}
        onCancel={() => setCancelOpen(false)}
        onConfirm={async () => {
          setCancelOpen(false);
          await run(cancelInvoiceAction, t("sales.invoiceCancelled"));
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={t("common.confirmDelete")}
        description={t("common.confirmDeleteBody")}
        confirmLabel={t("common.delete")}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={async () => {
          setDeleteOpen(false);
          const form = new FormData();
          form.set("invoiceId", String(invoiceId));
          const result = await deleteDraftInvoiceAction(form);
          if (result.ok) {
            toast({ title: t("common.deleted"), tone: "success" });
            router.push("/sales/invoices");
          } else {
            toast({ title: t("common.error"), description: result.error, tone: "error" });
          }
        }}
      />
    </div>
  );
}
