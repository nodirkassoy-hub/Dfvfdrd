"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui/primitives";
import { Icon, type IconName } from "@/components/ui/icon";
import { useApp } from "@/components/providers";
import { fromMinor, toMinor } from "@/lib/money";
import type { ActionState } from "@/lib/actions/support";

/**
 * Descriptor-driven create/edit form.
 *
 * Field definitions are plain data so a server component can build them; the
 * component only owns the interaction (modal, pending state, toast, refresh).
 */
export type FieldSpec = {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "date" | "number" | "money" | "qty" | "textarea" | "select" | "checkbox" | "hidden" | "password";
  required?: boolean;
  defaultValue?: string | number | boolean | null;
  placeholder?: string;
  help?: string;
  options?: { value: string | number; label: string }[];
  span?: 1 | 2;
  rows?: number;
  min?: number;
  max?: number;
  step?: string;
  /** For type="money"/"qty" — currency precision source. */
  currency?: string;
  disabled?: boolean;
};

function initialValue(field: FieldSpec): string {
  if (field.defaultValue === null || field.defaultValue === undefined) return "";
  if (field.type === "money") return String(fromMinor(Number(field.defaultValue), field.currency ?? "UZS"));
  if (field.type === "qty") return String(Number(field.defaultValue) / 1000);
  return String(field.defaultValue);
}

export function EntityForm({
  fields,
  action,
  submitLabel,
  cancelHref,
  hiddenValues,
  contextLabel,
  contextValue,
  extra,
  onSuccessHref,
}: {
  fields: FieldSpec[];
  action: (state: ActionState | undefined, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  cancelHref?: string;
  hiddenValues?: Record<string, string | number>;
  contextLabel?: string;
  contextValue?: string;
  extra?: React.ReactNode;
  onSuccessHref?: string;
}) {
  const router = useRouter();
  const { t, currency } = useApp();
  const { toast } = useToast();
  const [state, formAction, pending] = React.useActionState<ActionState | undefined, FormData>(action, undefined);

  React.useEffect(() => {
    if (state?.ok) {
      toast({ title: t("common.saved"), description: contextValue, tone: "success" });
      if (onSuccessHref) router.push(onSuccessHref.replace("{id}", String(state.id ?? "")));
      else router.refresh();
    }
  }, [state, router, t, toast, contextValue, onSuccessHref]);

  return (
    <form action={formAction} className="space-y-4">
      {hiddenValues
        ? Object.entries(hiddenValues).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)
        : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => {
          const value = initialValue(field);
          if (field.type === "hidden") return <input key={field.name} type="hidden" name={field.name} value={value} />;
          if (field.type === "checkbox") {
            return (
              <div key={field.name} className={field.span === 2 ? "sm:col-span-2" : undefined}>
                <Checkbox name={field.name} value="1" label={field.label} hint={field.help} defaultChecked={Boolean(field.defaultValue)} />
              </div>
            );
          }
          return (
            <Field key={field.name} label={field.label} required={field.required} hint={field.help} className={field.span === 2 ? "sm:col-span-2" : undefined}>
              {field.type === "textarea" ? (
                <Textarea name={field.name} rows={field.rows ?? 3} defaultValue={value} placeholder={field.placeholder} required={field.required} />
              ) : field.type === "select" ? (
                <Select name={field.name} defaultValue={value} required={field.required} disabled={field.disabled}>
                  <option value="">{t("common.selectPlaceholder")}</option>
                  {field.options?.map((option) => (
                    <option key={String(option.value)} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  name={field.name}
                  type={field.type === "money" || field.type === "qty" || field.type === "number" ? "number" : field.type ?? "text"}
                  step={field.step ?? (field.type === "money" ? "1" : field.type === "qty" ? "0.001" : undefined)}
                  min={field.min}
                  max={field.max}
                  defaultValue={value}
                  placeholder={field.placeholder}
                  required={field.required}
                  disabled={field.disabled}
                  className={field.type === "money" || field.type === "qty" ? "num" : undefined}
                />
              )}
            </Field>
          );
        })}
      </div>

      {extra}

      {state?.error ? (
        <p className="flex items-start gap-2 rounded-[11px] bg-negative-50 px-3 py-2 text-[12.5px] text-negative-600">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {cancelHref ? (
          <Button type="button" variant="ghost" onClick={() => router.push(cancelHref)}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={pending} icon={<Icon name="check" size={15} />}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Compact "+ New" button that opens the same descriptor-driven form in a modal. */
export function FormDialog({
  label,
  title,
  description,
  fields,
  action,
  submitLabel,
  icon = "plus",
  variant = "secondary",
  hiddenValues,
  onSuccessHref,
}: {
  label: string;
  title: string;
  description?: string;
  fields: FieldSpec[];
  action: (state: ActionState | undefined, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  icon?: IconName;
  variant?: "primary" | "secondary" | "ghost";
  hiddenValues?: Record<string, string | number>;
  onSuccessHref?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const { t } = useApp();
  return (
    <>
      <Button variant={variant} icon={<Icon name={icon} size={15} />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <EntityForm
          fields={fields}
          action={action}
          submitLabel={submitLabel}
          hiddenValues={hiddenValues}
          onSuccessHref={onSuccessHref}
          cancelHref={undefined}
        />
        <button type="button" className="sr-only" onClick={() => setOpen(false)}>
          {t("common.close")}
        </button>
      </Modal>
    </>
  );
}
