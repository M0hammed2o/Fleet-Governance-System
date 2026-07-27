"use client";

import { useEffect, useState, useCallback } from "react";

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  totalMinorUnits: number;
}

interface Payment {
  id: string;
  amountMinorUnits: number;
  currency: string;
  status: string;
  method: string;
  occurredAt: string;
}

interface Contact {
  id: string;
  name: string | null;
  email: string;
  isActive: boolean;
}

interface Overview {
  subscription: { status: string; suspendedReason: string | null };
  pricing: { baseFeeMinorUnits: number; perVehicleFeeMinorUnits: number; currency: string; source: string };
  activeVehicleCount: number;
  profile: { billingEmail: string | null; accountsContactEmail: string | null } | null;
}

function formatMoney(minorUnits: number, currency = "ZAR"): string {
  const symbol = currency === "ZAR" ? "R" : `${currency} `;
  return `${symbol}${(minorUnits / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CustomerBillingPortalPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newContactEmail, setNewContactEmail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, invoicesRes, paymentsRes, contactsRes] = await Promise.all([
        fetch("/api/billing/overview"),
        fetch("/api/billing/invoices"),
        fetch("/api/billing/payments"),
        fetch("/api/billing/contacts"),
      ]);
      const overviewBody = await overviewRes.json();
      const invoicesBody = await invoicesRes.json();
      const paymentsBody = await paymentsRes.json();
      const contactsBody = await contactsRes.json();
      if (!overviewRes.ok) throw new Error(overviewBody.error ?? "Failed to load billing overview");
      setOverview(overviewBody);
      if (invoicesRes.ok) setInvoices(invoicesBody.invoices);
      if (paymentsRes.ok) setPayments(paymentsBody.payments);
      if (contactsRes.ok) setContacts(contactsBody.contacts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function call(path: string, body?: object) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Action failed");
        return null;
      }
      await load();
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function downloadInvoice(invoiceId: string) {
    const res = await fetch(`/api/billing/invoices/${invoiceId}/download`);
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Could not generate a download link");
      return;
    }
    window.open(body.url, "_blank");
  }

  async function payInvoice(invoiceId: string) {
    await call(`/api/billing/invoices/${invoiceId}/pay`, {});
  }

  async function simulatePayment(invoiceId: string, outcome: "SUCCESSFUL" | "FAILED") {
    await call(`/api/billing/invoices/${invoiceId}/simulate-payment`, { outcome });
  }

  async function resendEmail(invoiceId: string) {
    const email = window.prompt("Resend the invoice PDF to which email address?", overview?.profile?.billingEmail ?? "");
    if (!email) return;
    await call(`/api/billing/invoices/${invoiceId}/resend-email`, { recipientEmail: email });
  }

  async function addContact() {
    if (!newContactEmail.trim()) return;
    await call("/api/billing/contacts", { email: newContactEmail });
    setNewContactEmail("");
  }

  if (loading) return <main className="p-8 text-sm text-slate-500">Loading…</main>;

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Billing</h1>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {overview && (
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Subscription and pricing</h2>
            <p className="text-sm text-slate-700">
              Status: <span className="font-medium">{overview.subscription.status}</span>
              {overview.subscription.status === "PAST_DUE" && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                  An invoice is overdue — please arrange payment to avoid suspension.
                </span>
              )}
              {overview.subscription.status === "SUSPENDED" && (
                <span className="ml-2 rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800">
                  Account suspended — new movements cannot be created until payment is resolved.
                </span>
              )}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {formatMoney(overview.pricing.baseFeeMinorUnits, overview.pricing.currency)} base fee + {formatMoney(overview.pricing.perVehicleFeeMinorUnits, overview.pricing.currency)}/active
              vehicle ({overview.pricing.source === "TENANT_NEGOTIATED" ? "negotiated rate" : "standard rate"})
            </p>
            <p className="text-sm text-slate-600">Currently billable active vehicles: {overview.activeVehicleCount}</p>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Invoices</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="p-2">Number</th>
                <th className="p-2">Status</th>
                <th className="p-2">Due</th>
                <th className="p-2">Total</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100">
                  <td className="p-2 font-mono text-xs">{inv.invoiceNumber}</td>
                  <td className="p-2">
                    {inv.status}
                    {inv.status === "OVERDUE" && <span className="ml-1 text-xs text-red-700">(overdue)</span>}
                  </td>
                  <td className="p-2">{new Date(inv.dueDate).toLocaleDateString()}</td>
                  <td className="p-2">{formatMoney(inv.totalMinorUnits, inv.currency)}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button onClick={() => downloadInvoice(inv.id)} className="text-slate-900 underline">
                        Download
                      </button>
                      <button onClick={() => resendEmail(inv.id)} className="text-slate-900 underline">
                        Resend email
                      </button>
                      {(inv.status === "ISSUED" || inv.status === "OVERDUE") && (
                        <>
                          <button disabled={busy} onClick={() => payInvoice(inv.id)} className="text-emerald-700 underline disabled:opacity-50">
                            Pay now (mock)
                          </button>
                          <button disabled={busy} onClick={() => simulatePayment(inv.id, "SUCCESSFUL")} className="text-emerald-700 underline disabled:opacity-50">
                            Simulate success
                          </button>
                          <button disabled={busy} onClick={() => simulatePayment(inv.id, "FAILED")} className="text-red-700 underline disabled:opacity-50">
                            Simulate failure
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-sm text-slate-500">
                    No invoices yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Payment history</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="p-2">Date</th>
                <th className="p-2">Amount</th>
                <th className="p-2">Method</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="p-2">{new Date(p.occurredAt).toLocaleDateString()}</td>
                  <td className="p-2">{formatMoney(p.amountMinorUnits, p.currency)}</td>
                  <td className="p-2">{p.method}</td>
                  <td className="p-2">{p.status}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-sm text-slate-500">
                    No payments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Billing contacts</h2>
          <ul className="space-y-1 text-sm text-slate-700">
            {contacts.map((c) => (
              <li key={c.id}>
                {c.email} {c.name ? `(${c.name})` : ""} {!c.isActive && <span className="text-xs text-slate-400">(inactive)</span>}
              </li>
            ))}
            {contacts.length === 0 && <li className="text-slate-500">No additional billing contacts.</li>}
          </ul>
          <div className="mt-3 flex gap-2">
            <input
              type="email"
              placeholder="New billing contact email"
              value={newContactEmail}
              onChange={(e) => setNewContactEmail(e.target.value)}
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button disabled={busy} onClick={addContact} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Add
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
