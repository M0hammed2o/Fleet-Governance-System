import crypto from "node:crypto";
import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";

/**
 * A real, tiny, valid JPEG — Phase 8B's upload pipeline runs actual image
 * compression (`lib/storage/image-compression.ts`, sharp), so a fixture
 * upload with `contentType: "image/jpeg"` must be real, decodable image
 * bytes, not arbitrary text (sharp throws on anything else). `seed` selects
 * a distinct fill colour so tests that need two different "images" (e.g.
 * checksum-uniqueness/idempotency-conflict cases) can request genuinely
 * different content while still requesting a valid one.
 */
export async function fakeImageBytes(seed = 0): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: seed % 256, g: (seed * 53) % 256, b: (seed * 97) % 256 } },
  })
    .jpeg()
    .toBuffer();
}

// crypto.randomUUID(), not a counter — test files run in parallel worker
// processes, each with its own module instance, so a per-module counter
// collides across files even though it looks unique within one file.
function unique(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

// Phase 8E-007: every tenant created via this helper is tracked so
// `cleanupCreatedTenants()` (called from a global Vitest afterAll — see
// tests/setup/global-cleanup.ts) can delete it once its file's tests
// finish. `onDelete: Cascade` on every tenant-owned table means deleting
// the Tenant row cascades through everything it owns — this is
// "deterministic fixture deletion", not a destructive reset, and only ever
// touches the disposable test database. A tenant created by direct
// `prisma.tenant.upsert()` (e.g. the canonical "platform"-slugged fixture
// some tests deliberately reuse across cases) is NOT tracked here and is
// therefore never auto-deleted.
const createdTenantIds: string[] = [];

export async function createTenant(namePrefix = "Test Tenant") {
  const slug = unique("tenant").toLowerCase();
  const tenant = await prisma.tenant.create({ data: { name: `${namePrefix} ${slug}`, slug } });
  createdTenantIds.push(tenant.id);
  return tenant;
}

/**
 * Deletes every tenant created via `createTenant()` in the current test
 * module. Best-effort per id, each in its own transaction — one failure
 * never blocks the rest.
 *
 * The `audit_logs` append-only trigger (migration
 * `20260720080000_invitations_and_audit_protection` — see
 * DATA_MODEL.md/ARCHITECTURE.md "Audit architecture") deliberately rejects
 * every DELETE against that table, including ones a cascading
 * `Tenant.delete()` would otherwise trigger — by design, so the guarantee
 * holds even against a direct DB connection. `SET LOCAL
 * session_replication_role = replica` is the standard Postgres mechanism
 * for an administrative bulk operation to bypass ordinary row triggers; it
 * is scoped to *this one transaction only* (never a session-wide or
 * global change, and it auto-reverts at transaction end whether commit or
 * rollback) and never runs anywhere near an actual assertion of the
 * trigger's behaviour — this is disposing of synthetic fixture data after
 * a test file's assertions have already finished, not weakening the
 * guarantee itself or anything under test.
 */
/**
 * For the rare test that creates a tenant through a real repository
 * function (e.g. `createTenantAsPlatformAdmin()`) rather than the
 * `createTenant()` fixture helper — not tracked automatically, so the test
 * itself calls this directly (typically in an `afterEach`/end-of-test
 * cleanup) instead of leaving an untracked, never-cleaned row behind.
 */
export async function deleteTenantForCleanup(tenantId: string): Promise<void> {
  await prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.tenant.delete({ where: { id: tenantId } });
    })
    .catch(() => {});
}

export async function cleanupCreatedTenants(): Promise<void> {
  const ids = createdTenantIds.splice(0, createdTenantIds.length);
  for (const id of ids) {
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await tx.tenant.delete({ where: { id } });
      })
      .catch(() => {});
  }
}

export async function createRole(tenantId: string, name = "Test Role") {
  return prisma.role.create({ data: { tenantId, name: `${name} ${unique("role")}` } });
}

export async function createUser(params: { tenantId: string; roleId: string; email: string; password?: string }) {
  const passwordHash = await hashPassword(params.password ?? "TestPassword!1");
  return prisma.user.create({
    data: {
      tenantId: params.tenantId,
      roleId: params.roleId,
      email: params.email,
      name: "Test User",
      passwordHash,
      status: "ACTIVE",
    },
  });
}

export async function grantPermission(roleId: string, resource: string, action: string) {
  const permission = await prisma.permission.upsert({
    where: { resource_action: { resource, action: action as never } },
    update: {},
    create: { resource, action: action as never },
  });
  return prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
}

export async function createSite(tenantId: string, name = "Test Site") {
  return prisma.site.create({ data: { tenantId, name: `${name} ${unique("site")}` } });
}

export async function createGate(tenantId: string, siteId: string, name = "Test Gate") {
  return prisma.gate.create({ data: { tenantId, siteId, name: `${name} ${unique("gate")}`, direction: "BOTH" } });
}

export async function createDriver(
  tenantId: string,
  overrides: Partial<{ name: string; status: "ACTIVE" | "SUSPENDED" | "BLACKLISTED" }> = {},
) {
  return prisma.driver.create({
    data: {
      tenantId,
      name: overrides.name ?? `Test Driver ${unique("driver")}`,
      status: overrides.status ?? "ACTIVE",
    },
  });
}

export async function createVehicle(
  tenantId: string,
  overrides: Partial<{
    registrationNumber: string;
    vin: string;
    operationalStatus: "OPERATIONAL" | "WORKSHOP_LOCKOUT" | "SECURITY_LOCKOUT" | "DECOMMISSIONED";
  }> = {},
) {
  return prisma.vehicle.create({
    data: {
      tenantId,
      registrationNumber: overrides.registrationNumber ?? unique("REG").toUpperCase(),
      vin: overrides.vin,
      operationalStatus: overrides.operationalStatus ?? "OPERATIONAL",
    },
  });
}
