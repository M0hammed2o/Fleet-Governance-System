import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/authorize";
import { OnboardingWizard } from "@/components/onboarding-wizard";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPermission(session, "tenant", "CONFIGURE"))) redirect("/dashboard");
  return <main className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8"><div className="mx-auto max-w-7xl"><div className="mb-6"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-800">Genbridge controlled demo</p><h1 className="mt-1 text-3xl font-semibold text-slate-950">Set up {session.roleName === "Company Administrator" ? "your company" : "the company"}</h1><p className="mt-2 text-sm text-slate-600">Progress is saved after every completed section and can be resumed after sign-in.</p></div><OnboardingWizard /></div></main>;
}
