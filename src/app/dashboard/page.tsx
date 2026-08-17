import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/authorize";
import { getManagementDashboard } from "@/lib/repositories/management-dashboard-repository";
import { PrivateImage } from "@/components/private-image";

const ratingStyle = {
  GOOD_STANDING: { icon: "✓", className: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  REVIEW_REQUIRED: { icon: "!", className: "border-amber-200 bg-amber-50 text-amber-950" },
  SERIOUS_ATTENTION: { icon: "×", className: "border-red-200 bg-red-50 text-red-950" },
} as const;

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const [canViewDrivers, canViewVehicles, canViewPlatform, canViewExternalPortal] = await Promise.all([
    hasPermission(session, "driver", "VIEW"), hasPermission(session, "vehicle", "VIEW"),
    hasPermission(session, "platformTenant", "CONFIGURE"), hasPermission(session, "externalAuditorPortal", "VIEW"),
  ]);
  if (!canViewDrivers || !canViewVehicles) {
    return <main className="min-h-screen bg-slate-100 px-4 py-10"><section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-800">Role-based access</p><h1 className="mt-2 text-3xl font-semibold text-slate-950">Workspace access</h1><p className="mt-3 text-sm text-slate-600">Signed in as {session.roleName}. Use the authorised portal for this role.</p><div className="mt-6 grid gap-3 sm:grid-cols-2">{canViewPlatform && <Link href="/platform/readiness" className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">Platform readiness</Link>}{canViewPlatform && <Link href="/platform/tenants" className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold">Customer tenants</Link>}{canViewExternalPortal && <Link href="/external-auditor" className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">External auditor portal</Link>}</div></section></main>;
  }
  const dashboard = await getManagementDashboard(session.tenantId);
  if (!dashboard) redirect("/login");
  const canViewAnalytics = await hasPermission(session, "governanceAnalytics", "VIEW");

  const metrics = [
    ["Fleet loaded", `${dashboard.metrics.totalVehicles} / ${dashboard.metrics.declaredVehicles}`, `${dashboard.metrics.outstandingVehicles} outstanding`],
    ["Drivers", dashboard.metrics.totalDrivers, `${dashboard.metrics.assignedDrivers} assigned · ${dashboard.metrics.unassignedDrivers} unassigned`],
    ["Vehicle availability", dashboard.metrics.activeVehicles, `${dashboard.metrics.unavailableVehicles} unavailable`],
    ["Expiry warnings", dashboard.metrics.expiringDocuments, "Due or expired within 45 days"],
    ["Open exceptions", dashboard.metrics.openExceptions, "Operational review queue"],
  ];

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Management overview</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{dashboard.tenant.name}</h1><p className="mt-2 max-w-2xl text-sm text-slate-300">Explainable fleet governance, assignments, expiry exposure and recent gate activity.</p></div>
            <div className="flex flex-wrap gap-2"><Link href="/onboarding" className="rounded-xl border border-white/20 px-4 py-2 text-sm font-medium hover:bg-white/10">Onboarding</Link><Link href="/admin/drivers" className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300">Add driver</Link><Link href="/admin/vehicles" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-100">Add vehicle</Link></div>
          </div>
          {dashboard.tenant.demoWorkspace && <div className="mt-6 rounded-2xl border border-amber-300/50 bg-amber-300/10 p-4 text-sm text-amber-100"><strong>Controlled synthetic demonstration.</strong> Tracking data is not live. <span className="font-bold">SYNTHETIC BIOMETRIC TEST — NOT REAL FACIAL VERIFICATION</span></div>}
        </header>

        <section aria-label="Fleet summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {metrics.map(([label, value, detail]) => <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></article>)}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-semibold text-slate-950">Driver governance ratings</h2><p className="mt-1 text-sm text-slate-500">Deterministic operational indicators. They are not findings of misconduct.</p></div>{canViewAnalytics && <Link href="/analytics" className="text-sm font-medium text-cyan-800 hover:underline">Governance analytics →</Link>}</div>
          <div className="mt-5 grid gap-4 lg:hidden">
            {dashboard.ratings.map(({ driver, currentVehicle, rating }) => { const style = ratingStyle[rating.status]; return <article key={driver.id} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 p-4"><div className="flex min-w-0 items-center gap-3"><div className="size-12 shrink-0 overflow-hidden rounded-full"><PrivateImage mediaAssetId={driver.portraitMediaAssetId} alt={`Profile image for ${driver.name}`} fallback={driver.name.split(" ").map((part) => part[0]).slice(0,2).join("")} /></div><div className="min-w-0 flex-1"><Link href={`/admin/drivers/${driver.id}`} className="font-semibold text-slate-950 hover:underline">{driver.name}</Link><p className="truncate text-sm text-slate-500">{currentVehicle ? `${currentVehicle.registrationNumber} · ${currentVehicle.category.replaceAll("_", " ")}` : "No vehicle assigned"}</p></div><span aria-label={rating.label} className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${style.className}`}>{style.icon} {rating.score}</span></div><p className="mt-3 text-sm font-medium text-slate-800">{rating.label}</p><p className="mt-1 break-words text-xs text-slate-500">{rating.factors.filter((factor) => factor.kind === "attention").slice(0,2).map((factor) => factor.label).join(" · ") || "No current attention factors"}</p></article>; })}
          </div>
          <div className="mt-5 hidden overflow-x-auto lg:block"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><th className="pb-3">Driver</th><th className="pb-3">Current vehicle</th><th className="pb-3">Category</th><th className="pb-3">Rating</th><th className="pb-3">Contributing reasons</th><th className="pb-3">Calculated</th></tr></thead><tbody>{dashboard.ratings.map(({ driver, currentVehicle, rating }) => { const style = ratingStyle[rating.status]; return <tr key={driver.id} className="border-b border-slate-100 align-top"><td className="py-4"><div className="flex items-center gap-3"><div className="size-10 overflow-hidden rounded-full"><PrivateImage mediaAssetId={driver.portraitMediaAssetId} alt={`Profile image for ${driver.name}`} fallback={driver.name.split(" ").map((part) => part[0]).slice(0,2).join("")} /></div><Link href={`/admin/drivers/${driver.id}`} className="font-semibold text-slate-950 hover:underline">{driver.name}</Link></div></td><td className="py-4">{currentVehicle ? <Link href={`/admin/vehicles/${currentVehicle.id}`} className="hover:underline">{currentVehicle.registrationNumber}<span className="block text-xs text-slate-500">{currentVehicle.fleetNumber ?? "No fleet number"}</span></Link> : <span className="text-slate-500">Unassigned</span>}</td><td className="py-4">{currentVehicle?.category.replaceAll("_", " ") ?? "—"}</td><td className="py-4"><span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${style.className}`}><span aria-hidden="true">{style.icon}</span>&nbsp;{rating.label} · {rating.score}</span></td><td className="max-w-sm py-4 text-xs leading-5 text-slate-600">{rating.factors.filter((factor) => factor.kind === "attention").slice(0,3).map((factor) => factor.label).join(" · ") || "No current attention factors"}</td><td className="py-4 text-xs text-slate-500">{rating.calculatedAt.toLocaleString()}</td></tr>; })}</tbody></table></div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold text-slate-950">Assignment overview</h2><p className="mt-2 text-sm text-slate-600">{dashboard.metrics.assignedDrivers} active assignment{dashboard.metrics.assignedDrivers === 1 ? "" : "s"}; {dashboard.metrics.unassignedDrivers} driver{dashboard.metrics.unassignedDrivers === 1 ? "" : "s"} currently unassigned.</p><Link href="/admin/assignments" className="mt-4 inline-flex rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Manage assignments</Link></article>
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold text-slate-950">Recent gate activity</h2><ul className="mt-3 space-y-3">{dashboard.recentGateEvents.map((event) => <li key={event.id} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 text-sm"><div><Link href={`/gate/events/${event.id}`} className="font-medium text-slate-900 hover:underline">{event.driver.name} · {event.vehicle.registrationNumber}</Link><p className="text-xs text-slate-500">{event.gate.name} · {event.direction} · {event.status}</p></div><time className="shrink-0 text-xs text-slate-500">{event.createdAt.toLocaleDateString()}</time></li>)}{dashboard.recentGateEvents.length === 0 && <li className="text-sm text-slate-500">No gate activity recorded yet.</li>}</ul></article>
        </section>
      </div>
    </main>
  );
}
