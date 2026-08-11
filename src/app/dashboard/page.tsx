import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/authorize";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const canViewGovernanceAnalytics = await hasPermission(session, "governanceAnalytics", "VIEW");

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-lg font-semibold text-slate-900">Signed in</h1>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">User ID</dt>
          <dd className="font-mono text-slate-900">{session.userId}</dd>
          <dt className="text-slate-500">Tenant ID</dt>
          <dd className="font-mono text-slate-900">{session.tenantId}</dd>
          <dt className="text-slate-500">Role</dt>
          <dd className="text-slate-900">{session.roleName}</dd>
        </dl>
        <p className="mt-6 text-sm text-slate-500">
          Foundation-phase placeholder. Role-appropriate dashboards land in Phase 3+ once gate events,
          exceptions, and documents exist to summarise.
        </p>
        {canViewGovernanceAnalytics && <Link href="/analytics" className="mt-6 block rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-950 hover:border-cyan-400"><strong className="block">Governance analytics</strong><span className="mt-1 block text-cyan-800">Open the tenant-scoped executive dashboard and explainable risk indicators.</span></Link>}
      </div>
    </main>
  );
}
