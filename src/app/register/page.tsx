import Link from "next/link";
import { DemoRegistrationForm } from "@/components/demo-registration-form";
import { isDemoRegistrationEnabled } from "@/lib/demo/environment";

export default function RegisterPage() {
  const enabled = isDemoRegistrationEnabled();
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-4 py-10 sm:py-16">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <section className="pt-6 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Genbridge Fleet Governance</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Build a customer-ready fleet demo in minutes.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">Create an isolated workspace, map your fleet composition, add synthetic drivers and staff, and launch an explainable governance dashboard.</p>
          <ul className="mt-8 space-y-3 text-sm text-slate-200">
            <li>✓ Private, tenant-isolated demonstration workspace</li>
            <li>✓ Saved onboarding progress</li>
            <li>✓ Deterministic green, yellow and red review indicators</li>
            <li>✓ No live tracking or real facial recognition</li>
          </ul>
        </section>
        <section className="rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div><h2 className="text-2xl font-semibold text-slate-950">Create demonstration account</h2><p className="mt-1 text-sm text-slate-500">All fields are for synthetic demonstration data.</p></div>
            <Link href="/login" className="shrink-0 text-sm font-medium text-cyan-800 underline-offset-4 hover:underline">Sign in</Link>
          </div>
          {enabled ? <DemoRegistrationForm /> : <div role="status" className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700"><p className="font-semibold text-slate-950">Registration is disabled</p><p className="mt-2">An administrator must explicitly enable the controlled demo flow in an approved non-production environment.</p></div>}
        </section>
      </div>
    </main>
  );
}
