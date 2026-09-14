import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <main className="grid-bg flex min-h-screen items-center justify-center px-4 py-10">
      <OnboardingForm userName={user.name} />
    </main>
  );
}
