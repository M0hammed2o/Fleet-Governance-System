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

export async function createTenant(namePrefix = "Test Tenant") {
  const slug = unique("tenant").toLowerCase();
  return prisma.tenant.create({ data: { name: `${namePrefix} ${slug}`, slug } });
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
