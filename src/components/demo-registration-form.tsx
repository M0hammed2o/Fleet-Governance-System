"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DemoRegistrationForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/api/demo/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          acceptDemoTerms: form.get("acceptDemoTerms") === "on",
          acceptSyntheticDisclosure: form.get("acceptSyntheticDisclosure") === "on",
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "The workspace could not be created.");
        return;
      }
      router.push("/onboarding");
      router.refresh();
    } catch {
      setError("The server could not be reached. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const field = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100";
  return (
    <form onSubmit={submit} className="space-y-6" aria-describedby="demo-disclosure">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-slate-950">Company workspace</legend>
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Company name<input className={field} name="companyName" required maxLength={200} autoComplete="organization" /></label>
        <label className="text-sm font-medium text-slate-700">Workspace code<input className={field} name="workspaceSlug" required minLength={3} maxLength={60} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="example-logistics" aria-describedby="workspace-help" /></label>
        <label className="text-sm font-medium text-slate-700">Industry<input className={field} name="industry" maxLength={120} placeholder="Transport and logistics" /></label>
        <p id="workspace-help" className="-mt-2 text-xs text-slate-500 sm:col-span-2">Keep this code: it is used with your email when signing in.</p>
        <label className="text-sm font-medium text-slate-700">Registration number<input className={field} name="companyRegistrationNumber" maxLength={100} /></label>
        <label className="text-sm font-medium text-slate-700">Company phone<input className={field} name="contactPhone" type="tel" maxLength={50} /></label>
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Company address<textarea className={field} name="address" maxLength={500} rows={2} /></label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-slate-950">First Company Administrator</legend>
        <label className="text-sm font-medium text-slate-700">Full name<input className={field} name="administratorName" required maxLength={200} autoComplete="name" /></label>
        <label className="text-sm font-medium text-slate-700">Email<input className={field} name="email" type="email" required maxLength={254} autoComplete="email" /></label>
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Password<input className={field} name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" aria-describedby="password-help" /></label>
        <p id="password-help" className="-mt-2 text-xs text-slate-500 sm:col-span-2">At least 10 characters with uppercase, lowercase and a number.</p>
      </fieldset>

      <div id="demo-disclosure" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">Controlled demonstration only</p>
        <p className="mt-1">Use fictitious people, vehicles, documents and locations. Tracking is synthetic; no live provider is connected.</p>
        <p className="mt-2 font-bold">SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION</p>
      </div>

      <label className="flex items-start gap-3 text-sm text-slate-700"><input className="mt-1 size-4" type="checkbox" name="acceptDemoTerms" required /><span>I accept the demonstration terms and understand this is not a production service.</span></label>
      <label className="flex items-start gap-3 text-sm text-slate-700"><input className="mt-1 size-4" type="checkbox" name="acceptSyntheticDisclosure" required /><span>I will use synthetic data only and understand that tracking and biometric demonstrations are simulated.</span></label>

      {error && <p role="alert" aria-live="assertive" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button disabled={submitting} className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700 disabled:opacity-50">
        {submitting ? "Creating secure demo workspace…" : "Create demo workspace"}
      </button>
    </form>
  );
}
