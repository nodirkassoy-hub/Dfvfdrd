"use client";

import { useActionState } from "react";
import { createCompanyAction, type ActionState } from "@/app/actions/auth";
import { Button, Card, Field, Input, Select } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";

export function OnboardingForm({ userName }: { userName: string }) {
  const [state, formAction, pending] = useActionState<ActionState | undefined, FormData>(createCompanyAction, undefined);

  return (
    <Card className="w-full max-w-[560px] p-7">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-brand-600 text-white">
          <Icon name="logo" size={18} />
        </span>
        <div>
          <h1 className="text-[17px] font-semibold">Create your first company</h1>
          <p className="text-[12.5px] text-muted">
            Welcome, {userName}. BUXAI sets up a complete chart of accounts, tax codes and defaults for you.
          </p>
        </div>
      </div>
      <form action={formAction} className="space-y-4">
        <Field label="Company name" required>
          <Input name="name" required placeholder="Apex Innovations LLC" autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tax ID (STIR)">
            <Input name="taxId" placeholder="301234567" />
          </Field>
          <Field label="Base currency">
            <Select name="currency" defaultValue="UZS">
              <option value="UZS">UZS — Uzbek so&#39;m</option>
              <option value="USD">USD — US dollar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="RUB">RUB — Russian ruble</option>
            </Select>
          </Field>
        </div>
        <Field label="Tax regime" hint="You can change this later in Settings → Tax.">
          <Select name="taxRegime" defaultValue="vat">
            <option value="vat">VAT payer (general regime)</option>
            <option value="turnover">Turnover tax regime</option>
            <option value="general">General regime (no VAT)</option>
          </Select>
        </Field>
        <Field label="Interface language">
          <Select name="locale" defaultValue="uz">
            <option value="uz">O&#39;zbekcha</option>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </Select>
        </Field>
        {state?.error ? (
          <p className="rounded-[10px] bg-negative-50 px-3 py-2 text-[12.5px] text-negative-600">{state.error}</p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
          Create company &amp; open dashboard
        </Button>
      </form>
    </Card>
  );
}
