import Link from "next/link";

export default function DriverNotFound() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-800">Driver records</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Driver not found</h1>
        <p className="mt-3 text-sm text-slate-600">This driver does not exist in your company workspace or is no longer available.</p>
        <Link href="/admin/drivers" className="mt-6 inline-flex rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
          Return to drivers
        </Link>
      </section>
    </main>
  );
}
