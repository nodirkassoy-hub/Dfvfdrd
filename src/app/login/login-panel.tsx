"use client";

import { useActionState, useState } from "react";
import { openDemoAction, signInAction, signUpAction, type ActionState } from "@/app/actions/auth";
import { Button, Card, Field, Input, Select } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";

export function LoginPanel({ demoAvailable }: { demoAvailable: boolean }) {
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [signInState, signIn, signInPending] = useActionState<ActionState | undefined, FormData>(signInAction, undefined);
  const [signUpState, signUp, signUpPending] = useActionState<ActionState | undefined, FormData>(signUpAction, undefined);
  const [demoPending, setDemoPending] = useState(false);

  return (
    <Card className="w-full max-w-[440px] p-6 sm:p-7">
      <div className="mb-5 flex items-center gap-3 lg:hidden">
        <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-brand-600 text-white">
          <Icon name="logo" size={18} />
        </span>
        <span className="text-[17px] font-semibold">BUXAI</span>
      </div>

      <div className="mb-6">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em]">
          {tab === "signin" ? "Welcome back" : "Create your workspace"}
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          {tab === "signin"
            ? "Sign in to your financial operating system."
            : "You get a complete chart of accounts, tax codes and a balanced ledger from the first minute."}
        </p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-1 rounded-[12px] border border-[color:var(--border)] surface-muted p-1">
        {(["signin", "signup"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`focus-ring rounded-[9px] px-3 py-1.5 text-[13px] font-medium transition-colors ${
              tab === value ? "surface text-[color:var(--text)] shadow-[var(--shadow-card)]" : "text-muted"
            }`}
          >
            {value === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      {tab === "signin" ? (
        <form action={signIn} className="space-y-4">
          <Field label="Email">
            <Input name="email" type="email" required autoComplete="email" placeholder="you@company.uz" />
          </Field>
          <Field label="Password">
            <Input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
          </Field>
          {signInState?.error ? (
            <p className="rounded-[10px] bg-negative-50 px-3 py-2 text-[12.5px] text-negative-600">{signInState.error}</p>
          ) : null}
          <Button type="submit" variant="primary" size="lg" loading={signInPending} className="w-full">
            Sign in
          </Button>
        </form>
      ) : (
        <form action={signUp} className="space-y-4">
          <Field label="Your name">
            <Input name="name" required autoComplete="name" placeholder="Aziz Karimov" />
          </Field>
          <Field label="Company name">
            <Input name="companyName" required placeholder="Apex Innovations LLC" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Base currency">
              <Select name="currency" defaultValue="UZS">
                <option value="UZS">UZS</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="RUB">RUB</option>
              </Select>
            </Field>
            <Field label="Language">
              <Select name="locale" defaultValue="uz">
                <option value="uz">O&#39;zbekcha</option>
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </Select>
            </Field>
          </div>
          <Field label="Email">
            <Input name="email" type="email" required autoComplete="email" placeholder="you@company.uz" />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <Input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="••••••••" />
          </Field>
          {signUpState?.error ? (
            <p className="rounded-[10px] bg-negative-50 px-3 py-2 text-[12.5px] text-negative-600">{signUpState.error}</p>
          ) : null}
          <Button type="submit" variant="primary" size="lg" loading={signUpPending} className="w-full">
            Create account
          </Button>
        </form>
      )}

      {demoAvailable ? (
        <>
          <div className="my-5 flex items-center gap-3 text-[11.5px] text-subtle">
            <span className="h-px flex-1 bg-[color:var(--border)]" />
            or
            <span className="h-px flex-1 bg-[color:var(--border)]" />
          </div>
          <form
            action={async () => {
              setDemoPending(true);
              await openDemoAction();
            }}
          >
            <Button type="submit" variant="secondary" size="lg" loading={demoPending} className="w-full" icon={<Icon name="sparkles" size={16} />}>
              Open the demo workspace
            </Button>
          </form>
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-subtle">
            A fully populated demo company (invoices, bank transactions, inventory, payroll) so you can explore every module.
            Demo data is completely isolated from companies you create.
          </p>
        </>
      ) : (
        <p className="mt-4 text-[11.5px] text-subtle">
          The demo workspace has not been seeded yet. Run <code className="num">npm run seed</code> to load it.
        </p>
      )}
    </Card>
  );
}
