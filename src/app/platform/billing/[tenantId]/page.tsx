"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  subtotalMinorUnits: number;
  vatAmountMinorUnits: number;
  totalMinorUnits: number;
  pdfMediaAssetId: string | null;
}

interface Payment {
  id: string;
  amountMinorUnits: number;
  currency: string;
  status: string;
  method: string;
  occurredAt: string;
}

interface Profile {
  id: string;
  registeredBusinessName: string | null;
  billingEmail: string | null;
  paymentTermsDays: number | null;
  gracePeriodDays: number | null;
}

interface Subscription {
  status: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
}

function formatMoney(minorUnits: number, currency = "ZAR"): string {
  const symbol = currency === "ZAR" ? "R" : `${currency} `;
  return `${symbol}${(minorUnits / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PlatformBillingCustomerDetailPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = use(params);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [baseFee, setBaseFee] = useState("");
  const [vehicleFee, setVehicleFee] = useState("");
  const [manualPaymentInvoiceId, setManualPaymentInvoiceId] = useState("");
  const [manualPaymentRef, setManualPaymentRef] = useState("");
  const [suspendReason, setSuspendReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/billing/customers/${tenantId}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load");
      setProfile(body.profile);
      setSubscription(body.subscription);
      setInvoices(body.invoices);
      setPayments(body.payments);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

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

  async function generateInvoice() {
    await call(`/api/platform/billing/customers/${tenantId}/invoices`);
  }

  async function setPricingAgreement() {
    const base = Math.round(Number(baseFee) * 100);
    const vehicle = Math.round(Number(vehicleFee) * 100);
    if (!Number.isFinite(base) || !Number.isFinite(vehicle)) return;
    await call(`/api/platform/billing/customers/${tenantId}/pricing-agreements`, { baseFeeMinorUnits: base, perVehicleFeeMinorUnits: vehicle });
    setBaseFee("");
    setVehicleFee("");
  }

  async function voidInvoice(invoiceId: string) {
    const reason = window.prompt("Reason for voiding this invoice?");
    if (!reason) return;
    await call(`/api/platform/billing/customers/${tenantId}/invoices/${invoiceId}/void`, { reason });
  }

  async function reissueInvoice(invoiceId: string) {
    const reason = window.prompt("Reason for reissuing this invoice?");
    if (!reason) return;
    await call(`/api/platform/billing/customers/${tenantId}/invoices/${invoiceId}/reissue`, { reason });
  }

  async function recordManualPayment(invoice: Invoice) {
    if (!manualPaymentRef.trim()) {
      setError("A proof/reference is required for a manual payment.");
      return;
    }
    await call(`/api/platform/billing/customers/${tenantId}/invoices/${invoice.id}/manual-payment`, {
      amountMinorUnits: invoice.totalMinorUnits,
      currency: invoice.currency,
      proofReference: manualPaymentRef,
    });
    setManualPaymentInvoiceId("");
    setManualPaymentRef("");
  }

  async function resendEmail(invoiceId: string) {
    const email = window.prompt("Resend the invoice PDF to which email address?", profile?.billingEmail ?? "");
    if (!email) return;
    await call(`/api/platform/billing/customers/${tenantId}/invoices/${invoiceId}/resend-email`, { recipientEmail: email });
  }

  async function downloadInvoice(invoiceId: string) {
    const res = await fetch(`/api/platform/billing/customers/${tenantId}/invoices/${invoiceId}/download`);
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Could not generate a download link");
      return;
    }
    window.open(body.url, "_blank");
  }

  async function suspend() {
    if (!suspendReason.trim()) {
      setError("A reason is required to suspend access.");
      return;
    }
    await call(`/api/platform/billing/customers/${tenantId}/subscription/suspend`, { reason: suspendReason });
    setSuspendReason("");
  }

  async function restore() {
    await call(`/api/platform/billing/customers/${tenantId}/subscription/restore`);
  }

  if (loading) return <main className="p-8 text-sm text-slate-500">Loading…</main>;

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <Link href="/platform/billing" className="text-sm text-slate-500 underline">
          ← Back to billing dashboard
        </Link>
        <h1 className="text-lg font-semibold text-slate-900">{profile?.registeredBusinessName ?? "Customer billing"}</h1>
        <Link href="/platform/support-access" className="text-sm text-slate-500 underline">
          Open in platform support access (read-only customer view)
        </Link>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Subscription</h2>
          <p className="text-sm text-slate-700">
            Status: <span className="font-medium">{subscription?.status}</span>
            {subscription?.suspendedReason && <span className="ml-2 text-xs text-red-700">({subscription.suspendedReason})</span>}
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              placeholder="Suspension reason"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button disabled={busy} onClick={suspend} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50">
              Suspend
            </button>
            <button disabled={busy} onClick={restore} className="rounded-md border border-emerald-300 px-3 py-2 text-sm text-emerald-700 disabled:opacity-50">
              Restore
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Pricing agreement</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">
              Base fee (ZAR)
              <input type="number" value={baseFee} onChange={(e) => setBaseFee(e.target.value)} className="block w-32 rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs text-slate-500">
              Per-vehicle fee (ZAR)
              <input type="number" value={vehicleFee} onChange={(e) => setVehicleFee(e.target.value)} className="block w-32 rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <button disabled={busy} onClick={setPricingAgreement} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Set negotiated pricing
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Invoices</h2>
            <button disabled={busy} onClick={generateInvoice} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Generate invoice for current period
            </button>
          </div>
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
                <tr key={inv.id} className="border-b border-slate-100 align-top">
                  <td className="p-2 font-mono text-xs">{inv.invoiceNumber}</td>
                  <td className="p-2">{inv.status}</td>
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
                      {inv.status !== "PAID" && inv.status !== "VOID" && (
                        <button onClick={() => voidInvoice(inv.id)} className="text-red-700 underline">
                          Void
                        </button>
                      )}
                      {inv.status === "VOID" && (
                        <button onClick={() => reissueInvoice(inv.id)} className="text-slate-900 underline">
                          Reissue
                        </button>
                      )}
                      {inv.status !== "PAID" && inv.status !== "VOID" && (
                        <button onClick={() => setManualPaymentInvoiceId(inv.id)} className="text-slate-900 underline">
                          Record manual payment
                        </button>
                      )}
                    </div>
                    {manualPaymentInvoiceId === inv.id && (
                      <div className="mt-2 flex gap-2">
                        <input
                          type="text"
                          placeholder="Proof / reference (e.g. EFT ref)"
                          value={manualPaymentRef}
                          onChange={(e) => setManualPaymentRef(e.target.value)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        />
                        <button disabled={busy} onClick={() => recordManualPayment(inv)} className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
                          Confirm
                        </button>
                      </div>
                    )}
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
      </div>
    </main>
  );
}
