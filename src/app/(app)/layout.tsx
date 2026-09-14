import { requireContext } from "@/lib/auth/guard";
import { navBadges } from "@/lib/services/dashboard";
import { AppProvider } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await requireContext();
  const badges = navBadges(context.company.id);

  return (
    <AppProvider
      locale={context.locale}
      currency={context.currency}
      companyId={context.company.id}
      companyName={context.company.name}
      theme={context.user.theme === "dark" ? "dark" : "light"}
    >
      <AppShell
        companies={context.companies.map((company) => ({
          id: company.companyId,
          name: company.companyName,
          role: company.role,
          isDemo: company.isDemo,
        }))}
        activeCompanyId={context.company.id}
        isDemo={context.company.is_demo === 1}
        badges={badges}
        nested={false}
      >
        {children}
      </AppShell>
    </AppProvider>
  );
}
