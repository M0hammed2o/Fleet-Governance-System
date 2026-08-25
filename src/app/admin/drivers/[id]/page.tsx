import { notFound, redirect } from "next/navigation";
import { DriverDetailClient } from "./driver-detail-client";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/authorize";
import { getDriverInTenant } from "@/lib/repositories/driver-repository";

/**
 * Resolve authentication, authorization and tenant-scoped existence before
 * the client shell can stream. This makes a genuinely missing (or
 * cross-tenant) driver a real HTTP 404 instead of an HTTP-200 page that later
 * replaces "Loading" with an inline error.
 */
export default async function DriverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPermission(session, "driver", "VIEW"))) redirect("/dashboard");

  const { id } = await params;
  if (!(await getDriverInTenant(session.tenantId, id))) notFound();

  return <DriverDetailClient id={id} />;
}
