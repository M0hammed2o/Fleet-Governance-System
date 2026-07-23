import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

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
      </div>
    </main>
  );
}
