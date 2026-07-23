"use client";

import { useEffect, useState, useCallback } from "react";

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED" | "INVITED";
  roleName: string;
  lastLoginAt: string | null;
}

interface PendingInvitation {
  id: string;
  email: string;
  name: string;
  expiresAt: string;
}

interface RoleOption {
  id: string;
  name: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [pending, setPending] = useState<PendingInvitation[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState("");
  const [inviting, setInviting] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, rolesRes] = await Promise.all([fetch("/api/admin/users"), fetch("/api/admin/roles")]);
      const usersData = await usersRes.json();
      const rolesData = await rolesRes.json();
      if (!usersRes.ok) throw new Error(usersData.error ?? "Failed to load users");
      if (!rolesRes.ok) throw new Error(rolesData.error ?? "Failed to load roles");
      setUsers(usersData.users);
      setPending(usersData.pendingInvitations);
      setRoles(rolesData.roles);
      setInviteRoleId((current) => current || rolesData.roles[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred a tick so the initial fetch's setState calls don't run
    // synchronously inside the effect body (react-hooks/set-state-in-effect).
    queueMicrotask(load);
  }, [load]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setLastInviteLink(null);
    setInviting(true);
    try {
      const res = await fetch("/api/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, name: inviteName, roleId: inviteRoleId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Failed to invite user");
        return;
      }
      setLastInviteLink(`${window.location.origin}/accept-invitation?token=${data.invitationToken}`);
      setInviteEmail("");
      setInviteName("");
      await load();
    } catch {
      setActionError("Could not reach the server.");
    } finally {
      setInviting(false);
    }
  }

  async function handleSuspend(userId: string) {
    setActionError(null);
    const res = await fetch(`/api/admin/users/${userId}/suspend`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setActionError(data.error ?? "Failed to suspend user");
      return;
    }
    await load();
  }

  async function handleReactivate(userId: string) {
    setActionError(null);
    const res = await fetch(`/api/admin/users/${userId}/reactivate`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setActionError(data.error ?? "Failed to reactivate user");
      return;
    }
    await load();
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Users</h1>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Invite a user</h2>
          <form onSubmit={handleInvite} className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-slate-700">Name</label>
              <input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                required
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-slate-700">Email</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-slate-700">Role</label>
              <select
                value={inviteRoleId}
                onChange={(e) => setInviteRoleId(e.target.value)}
                required
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-1">
              <button
                type="submit"
                disabled={inviting || !inviteRoleId}
                className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {inviting ? "Inviting…" : "Send invite"}
              </button>
            </div>
          </form>

          {actionError && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}

          {lastInviteLink && (
            <p className="mt-3 break-all rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              No email provider is configured yet — share this invite link with the user directly:
              <br />
              {lastInviteLink}
            </p>
          )}
        </section>

        {pending.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Pending invitations</h2>
            <ul className="space-y-1 text-sm text-slate-600">
              {pending.map((inv) => (
                <li key={inv.id}>
                  {inv.name} ({inv.email}) — expires {new Date(inv.expiresAt).toLocaleDateString()}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">All users</h2>
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {!loading && !error && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Email</th>
                  <th className="pb-2">Role</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100">
                    <td className="py-2">{u.name}</td>
                    <td className="py-2">{u.email}</td>
                    <td className="py-2">{u.roleName}</td>
                    <td className="py-2">
                      <span
                        className={
                          u.status === "ACTIVE"
                            ? "text-emerald-700"
                            : u.status === "SUSPENDED"
                              ? "text-red-700"
                              : "text-amber-700"
                        }
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      {u.status === "ACTIVE" && (
                        <button
                          onClick={() => handleSuspend(u.id)}
                          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        >
                          Suspend
                        </button>
                      )}
                      {u.status === "SUSPENDED" && (
                        <button
                          onClick={() => handleReactivate(u.id)}
                          className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                        >
                          Reactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
