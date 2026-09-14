import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ensureDemoUserExists } from "@/app/actions/auth";
import { LoginPanel } from "./login-panel";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  const demoAvailable = await ensureDemoUserExists();
  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-12 text-white lg:flex">
        <div className="grid-bg absolute inset-0 opacity-[0.18]" />
        <div className="relative">
          <div className="mb-10 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-brand-600 text-white shadow-[0_4px_20px_rgba(67,56,202,0.5)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <path d="M4.5 19V6.2c0-.9.7-1.7 1.7-1.7h5.4c2.5 0 4.2 1.3 4.2 3.4 0 1.6-1 2.7-2.4 3.1 1.8.4 3 1.6 3 3.6 0 2.5-1.9 4.1-4.9 4.1H4.5Z" />
                <path d="M9.6 11.2h2.2" />
                <path d="M17.4 4.6 20 7.2" />
              </svg>
            </span>
            <span className="text-[19px] font-semibold tracking-[-0.02em]">BUXAI</span>
          </div>

          <h1 className="max-w-[520px] text-[38px] leading-[1.12] font-semibold tracking-[-0.03em]">
            Your company&#39;s financial operating system.
          </h1>
          <p className="mt-4 max-w-[460px] text-[14.5px] leading-relaxed text-white/60">
            A real double-entry accounting engine with invoicing, banking and reconciliation, inventory, payroll, tax, reporting —
            and an AI finance centre that answers only from your own posted transactions.
          </p>

          <ul className="mt-9 grid max-w-[520px] gap-3">
            {[
              ["ledger", "Every figure traces back to a journal entry — one source of truth."],
              ["radar", "Xato Radar scans for duplicate, unusual and inconsistent postings."],
              ["shield", "Roles, audit trail and period locking on every company you manage."],
            ].map(([icon, text]) => (
              <li key={text} className="flex items-start gap-3 rounded-[14px] border border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-white/10">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    {icon === "ledger" ? <><path d="M5 4.5h11a2.5 2.5 0 0 1 2.5 2.5v12.5H7.5A2.5 2.5 0 0 1 5 17Z" /><path d="M5 17a2.5 2.5 0 0 1 2.5-2.5h10.9" /></> : null}
                    {icon === "radar" ? <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12 18 7" /></> : null}
                    {icon === "shield" ? <><path d="M12 3.5 19 6v6c0 4.2-2.9 7.2-7 8.5-4.1-1.3-7-4.3-7-8.5V6z" /><path d="m9 12 2 2 4-4" /></> : null}
                  </svg>
                </span>
                <span className="text-[13px] leading-snug text-white/75">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11.5px] text-white/40">
          BUXAI calculates tax figures from your own ledger and always shows the source. It does not provide legal or tax advice.
        </p>
      </section>

      <section className="surface flex items-center justify-center px-5 py-10">
        <LoginPanel demoAvailable={demoAvailable} />
      </section>
    </main>
  );
}
