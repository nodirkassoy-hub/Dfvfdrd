import { redirect } from "next/navigation";
import { clearSession } from "@/lib/auth/session";

export async function GET() {
  await clearSession();
  redirect("/login");
}
