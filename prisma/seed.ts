/**
 * Dev/demo seed data only. Names, emails and passwords below are fictional —
 * see DATA_AND_DEMO_RULES in the build brief / MVP_SCOPE.md. Never point this
 * script at a production database.
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { listAllPermissions, permissionKey, type PermissionResource, type PermissionAction } from "../src/lib/auth/permissions";
import { assertSafeToSeed } from "../src/lib/db/seed-guard";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
assertSafeToSeed(connectionString);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DEV_PASSWORD = "GateFleet!Dev1"; // fictional dev-only password, same for every seeded user
const STORAGE_LOCAL_PATH = process.env.STORAGE_LOCAL_PATH || "./.data/media";

/**
 * Writes a small fictional placeholder file straight into the same directory
 * LocalFilesystemStorageProvider uses, and creates the matching MediaAsset
 * row directly via Prisma — same "seed writes the target state directly, not
 * through the repository layer" convention already used for GateEvent
 * (repository files, and lib/storage/local-filesystem-provider.ts, are
 * `import "server-only"` tagged and throw if imported into this plain tsx
 * script — see WORKLOG.md 2026-07-21). No real image/video binary content is
 * stored in the repo — a tiny fictional text blob on disk is enough to
 * exercise the upload/serve/checksum path end-to-end for the demo.
 */
async function seedMediaAsset(params: {
  tenantId: string;
  ownerType: "GATE_EVENT" | "GATE_EVENT_INSPECTION_ITEM" | "MANUAL_FACIAL_VERIFICATION_FALLBACK" | "DRIVER_PORTRAIT" | "COMPLIANCE_DOCUMENT";
  ownerId: string;
  capturedByUserId: string;
  fileName: string;
  contentType: string;
  contents: string;
  idempotencyKey: string;
}) {
  const existing = await prisma.mediaAsset.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: params.tenantId, idempotencyKey: params.idempotencyKey } },
  });
  if (existing) return existing;

  const data = Buffer.from(params.contents, "utf8");
  const checksumSha256 = crypto.createHash("sha256").update(data).digest("hex");
  const storageKey = `${params.tenantId}/${crypto.randomUUID()}-${params.fileName}`;
  const fullPath = path.resolve(process.cwd(), STORAGE_LOCAL_PATH, storageKey);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, data);
  fs.writeFileSync(`${fullPath}.meta.json`, JSON.stringify({ contentType: params.contentType }), "utf8");

  return prisma.mediaAsset.create({
    data: {
      tenantId: params.tenantId,
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      capturedByUserId: params.capturedByUserId,
      fileName: params.fileName,
      contentType: params.contentType,
      fileSizeBytes: data.byteLength,
      storageKey,
      checksumSha256,
      idempotencyKey: params.idempotencyKey,
    },
  });
}

type RolePermissionSpec = { resource: PermissionResource; action: PermissionAction }[];

// Tenant-scoped roles. As of 2026-07-23 this maps onto the six primary
// customer roles + three additional non-daily profiles specified by the
// user (see DECISIONS.md D-015 and WORKLOG.md Session 6/7 for the full
// mapping rationale from the original 8-role set). Resources introduced in
// later phases (telematics, vehicleUsePolicy, supportAccessSession, ...)
// will extend these mappings as each module lands — see TODO.md.
const TENANT_ROLE_DEFINITIONS: Record<string, { description: string; permissions: RolePermissionSpec }> = {
  // --- Primary role 1/6 ---
  "Company Administrator": {
    description: "Configures the company, sites, gates, users and operational policy. Full oversight visibility. Cannot silently alter immutable gate evidence (view-only on media).",
    permissions: [
      { resource: "site", action: "VIEW" }, { resource: "site", action: "CREATE" }, { resource: "site", action: "EDIT" }, { resource: "site", action: "DELETE" }, { resource: "site", action: "CONFIGURE" },
      { resource: "gate", action: "VIEW" }, { resource: "gate", action: "CREATE" }, { resource: "gate", action: "EDIT" }, { resource: "gate", action: "DELETE" }, { resource: "gate", action: "CONFIGURE" },
      { resource: "user", action: "VIEW" }, { resource: "user", action: "CREATE" }, { resource: "user", action: "EDIT" }, { resource: "user", action: "DELETE" }, { resource: "user", action: "CONFIGURE" },
      { resource: "role", action: "VIEW" }, { resource: "role", action: "CREATE" }, { resource: "role", action: "EDIT" }, { resource: "role", action: "DELETE" }, { resource: "role", action: "CONFIGURE" },
      { resource: "tenant", action: "VIEW" }, { resource: "tenant", action: "CONFIGURE" },
      { resource: "auditLog", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" }, { resource: "movement", action: "VIEW" },
      { resource: "complianceDocument", action: "VIEW" },
      { resource: "tyrePositionConfig", action: "VIEW" }, { resource: "tyrePositionConfig", action: "CREATE" }, { resource: "tyrePositionConfig", action: "EDIT" }, { resource: "tyrePositionConfig", action: "DELETE" }, { resource: "tyrePositionConfig", action: "CONFIGURE" },
      { resource: "facialVerificationFallback", action: "VIEW" }, { resource: "facialVerificationFallback", action: "APPROVE" }, { resource: "facialVerificationFallback", action: "REJECT" },
      { resource: "gateEvent", action: "VIEW" },
      { resource: "inspectionTemplate", action: "VIEW" }, { resource: "inspectionTemplate", action: "CREATE" }, { resource: "inspectionTemplate", action: "EDIT" }, { resource: "inspectionTemplate", action: "DELETE" }, { resource: "inspectionTemplate", action: "CONFIGURE" },
      { resource: "exception", action: "VIEW" }, { resource: "exception", action: "CONFIGURE" },
      // Oversight visibility only — Company Administrator doesn't personally
      // capture gate/driver/document evidence.
      { resource: "mediaAsset", action: "VIEW" },
    ],
  },
  // --- Primary role 2/6 — new, carved out of the old "Fleet Manager"'s
  // movement duties. Plans/creates/submits movements; never approves its own
  // (no movement:APPROVE/REJECT at all — segregation of duties is structural,
  // not just a runtime self-approval check). ---
  "Dispatch and Logistics Officer": {
    description: "Plans deliveries, collections and other movements: assigns driver/vehicle, records destination/customer/purpose/sender/recipient/references, uploads delivery notes, submits for approval. Cannot approve movements.",
    permissions: [
      { resource: "site", action: "VIEW" }, { resource: "gate", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" },
      { resource: "movement", action: "VIEW" }, { resource: "movement", action: "CREATE" }, { resource: "movement", action: "EDIT" },
      { resource: "gateEvent", action: "VIEW" },
      // Uploads delivery notes / supporting movement documents directly
      // (Phase 5C — MediaAsset-backed, not a public URL).
      { resource: "mediaAsset", action: "VIEW" }, { resource: "mediaAsset", action: "CREATE" },
    ],
  },
  // --- Primary role 3/6 — unchanged from the original 8-role set. ---
  "Gate Security Officer": {
    description: "Retrieves approved movements, verifies the driver, performs entry/exit inspections, captures readings/photographs/video, raises exceptions. Cannot approve its own serious exception; cannot edit financial data (no complianceDocument/movement write access at all).",
    permissions: [
      { resource: "site", action: "VIEW" },
      { resource: "gate", action: "VIEW" },
      // Read-only against master data — gate security confirms against the
      // already-approved record, never edits driver/vehicle/movement data.
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" }, { resource: "movement", action: "VIEW" },
      { resource: "facialVerificationFallback", action: "VIEW" }, { resource: "facialVerificationFallback", action: "CREATE" },
      // Runs the gate check-in/check-out flow end-to-end (start, inspect,
      // clear/deny normal cases) but cannot resolve a serious exception —
      // no exception:APPROVE. See "Security Supervisor / Approving Manager".
      { resource: "gateEvent", action: "VIEW" }, { resource: "gateEvent", action: "CREATE" }, { resource: "gateEvent", action: "EDIT" },
      { resource: "inspectionTemplate", action: "VIEW" },
      { resource: "exception", action: "VIEW" }, { resource: "exception", action: "CREATE" },
      // Captures walk-around/inspection-item evidence during their own gate
      // event (build brief EVID item 3).
      { resource: "mediaAsset", action: "VIEW" }, { resource: "mediaAsset", action: "CREATE" },
    ],
  },
  // --- Primary role 4/6 — merge of the old "Security Manager" (gate
  // exception/checklist oversight) and "Approving Manager" (movement
  // approval), per the user's explicit role spec. Gate CONFIGURE moved to
  // Company Administrator (see DECISIONS.md D-015) rather than staying here. ---
  "Security Supervisor / Approving Manager": {
    description: "Approves/rejects submitted movements, reviews and resolves gate exceptions, approves manual facial-verification fallback, reviews security dashboards. Cannot rewrite original evidence (view-only on media).",
    permissions: [
      { resource: "site", action: "VIEW" }, { resource: "gate", action: "VIEW" },
      { resource: "user", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" },
      { resource: "movement", action: "VIEW" }, { resource: "movement", action: "APPROVE" }, { resource: "movement", action: "REJECT" },
      { resource: "facialVerificationFallback", action: "VIEW" }, { resource: "facialVerificationFallback", action: "APPROVE" }, { resource: "facialVerificationFallback", action: "REJECT" },
      { resource: "gateEvent", action: "VIEW" },
      // Owns the inspection checklist and exception-type catalogue, and is
      // the intended supervisor who resolves serious exceptions raised by a
      // Gate Security Officer — deliberately not the same role that has
      // exception:CREATE, so the self-approval rule and the
      // unauthorised-approval boundary are both meaningfully testable.
      { resource: "inspectionTemplate", action: "VIEW" }, { resource: "inspectionTemplate", action: "CREATE" }, { resource: "inspectionTemplate", action: "EDIT" }, { resource: "inspectionTemplate", action: "CONFIGURE" },
      { resource: "exception", action: "VIEW" }, { resource: "exception", action: "APPROVE" }, { resource: "exception", action: "CONFIGURE" },
      { resource: "mediaAsset", action: "VIEW" },
    ],
  },
  // --- Primary role 5/6 — renamed/refocused "Fleet Manager": keeps
  // driver/vehicle master-data ownership, loses movement CREATE/EDIT (that's
  // Dispatch and Logistics Officer's job now). Telematics/GPS permissions
  // are added here once that resource exists (Phase 6). ---
  "Fleet and GPS Manager": {
    description: "Maintains driver/vehicle master data, vehicle-to-tracker mappings, GPS provider connections and geofences/vehicle-use policies (Phase 6), reviews utilisation and trip history.",
    permissions: [
      { resource: "site", action: "VIEW" },
      { resource: "gate", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "driver", action: "CREATE" }, { resource: "driver", action: "EDIT" }, { resource: "driver", action: "DELETE" }, { resource: "driver", action: "EXPORT" },
      { resource: "vehicle", action: "VIEW" }, { resource: "vehicle", action: "CREATE" }, { resource: "vehicle", action: "EDIT" }, { resource: "vehicle", action: "DELETE" }, { resource: "vehicle", action: "EXPORT" },
      { resource: "complianceDocument", action: "VIEW" }, { resource: "complianceDocument", action: "CREATE" }, { resource: "complianceDocument", action: "EDIT" }, { resource: "complianceDocument", action: "DELETE" },
      { resource: "tyrePositionConfig", action: "VIEW" },
      // View-only on movements — reviews dispatch/utilisation but doesn't
      // create dispatch requests (see "Dispatch and Logistics Officer").
      { resource: "movement", action: "VIEW" },
      { resource: "gateEvent", action: "VIEW" },
      // Owns driver/vehicle master data, including portraits and compliance
      // document attachments — needs upload rights for those, not just
      // gate-side evidence (build brief EVID item 3).
      { resource: "mediaAsset", action: "VIEW" }, { resource: "mediaAsset", action: "CREATE" },
    ],
  },
  // --- Primary role 6/6 — renamed/refocused "Risk/Compliance Manager".
  // Review-only across the board per the explicit "must not edit original
  // inspections, GPS history, photographs, videos or audit events" rule —
  // no resource below grants anything beyond VIEW/AUDIT(verify). ---
  "Accountant / Finance and Compliance Officer": {
    description: "Reviews fuel/odometer information, maintains licence/renewal/compliance dates, reviews customer-side financial/compliance reporting. Never edits original inspections, GPS history, photographs, videos or audit events.",
    permissions: [
      { resource: "site", action: "VIEW" },
      { resource: "gate", action: "VIEW" },
      { resource: "auditLog", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" }, { resource: "movement", action: "VIEW" },
      { resource: "complianceDocument", action: "VIEW" }, { resource: "complianceDocument", action: "AUDIT" },
      { resource: "gateEvent", action: "VIEW" },
      { resource: "inspectionTemplate", action: "VIEW" },
      { resource: "exception", action: "VIEW" },
      { resource: "mediaAsset", action: "VIEW" },
    ],
  },
  // --- Additional non-daily profile 1/3 — renamed "Internal Auditor". ---
  "Internal Investigator / Auditor": {
    description: "Read-only access to evidence, reports and audit history, for internal investigations. Can record control-test results and findings where authorised (Phase 6 Governance).",
    permissions: [
      { resource: "site", action: "VIEW" },
      { resource: "gate", action: "VIEW" },
      { resource: "user", action: "VIEW" },
      { resource: "auditLog", action: "VIEW" }, { resource: "auditLog", action: "EXPORT" },
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" }, { resource: "movement", action: "VIEW" },
      { resource: "complianceDocument", action: "VIEW" },
      { resource: "gateEvent", action: "VIEW" },
      { resource: "inspectionTemplate", action: "VIEW" },
      { resource: "exception", action: "VIEW" },
      // Views evidence for audit purposes but never creates it — see
      // SECURITY_AND_POPIA.md / TESTING.md "unauthorised roles cannot view
      // facial or video evidence" (this role is deliberately authorised,
      // exercising the allowed side of that boundary).
      { resource: "mediaAsset", action: "VIEW" },
    ],
  },
  // --- Additional non-daily profile 2/3 — new. More restricted than the
  // internal profile: no visibility into internal staff (no user:VIEW), no
  // audit export, no inspection-template/checklist-config visibility. An
  // external party (e.g. insurance/compliance reviewer) sees case-relevant
  // evidence and records, not internal operational configuration. ---
  "External Reviewer": {
    description: "Restricted read-only access for an external reviewer (e.g. insurer, external compliance auditor) — evidence and records only, no internal staff/configuration visibility, no export.",
    permissions: [
      { resource: "site", action: "VIEW" },
      { resource: "gate", action: "VIEW" },
      { resource: "auditLog", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" }, { resource: "movement", action: "VIEW" },
      { resource: "complianceDocument", action: "VIEW" },
      { resource: "gateEvent", action: "VIEW" },
      { resource: "exception", action: "VIEW" },
      { resource: "mediaAsset", action: "VIEW" },
    ],
  },
  // --- Additional non-daily profile 3/3 — renamed "Executive Viewer". ---
  "Executive Read-Only Viewer": {
    description: "Read-only dashboards and reports for executive oversight. Deliberately no media/evidence access — aggregate reporting only.",
    permissions: [
      { resource: "site", action: "VIEW" },
      { resource: "gate", action: "VIEW" },
      { resource: "driver", action: "VIEW" }, { resource: "vehicle", action: "VIEW" }, { resource: "movement", action: "VIEW" },
      { resource: "gateEvent", action: "VIEW" },
      // Deliberately no mediaAsset permission at all — dashboards/aggregate
      // reporting only (SECURITY_AND_POPIA.md "Internal" classification),
      // never raw evidence, mirroring their existing lack of
      // complianceDocument access.
    ],
  },
};

async function main() {
  console.log("Seeding permission catalogue...");
  const permissionRows = await Promise.all(
    listAllPermissions().map(({ resource, action }) =>
      prisma.permission.upsert({
        where: { resource_action: { resource, action } },
        update: {},
        create: { resource, action },
      }),
    ),
  );
  const permissionIdByKey = new Map(permissionRows.map((p) => [permissionKey(p.resource, p.action), p.id]));

  // --- Platform tenant + Platform Administrator -----------------------------
  console.log("Seeding platform tenant...");
  const platformTenant = await prisma.tenant.upsert({
    where: { slug: "platform" },
    update: {},
    create: { name: "Gate Fleet Governance — Platform", slug: "platform" },
  });

  const platformAdminRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: platformTenant.id, name: "Platform Administrator" } },
    update: {},
    create: {
      tenantId: platformTenant.id,
      name: "Platform Administrator",
      description: "Manages tenant organisations. Restricted support access — cannot silently access tenant evidence.",
      isSystem: true,
    },
  });
  for (const action of ["VIEW", "CREATE", "EDIT", "CONFIGURE"] as const) {
    const permissionId = permissionIdByKey.get(permissionKey("platformTenant", action));
    if (!permissionId) continue;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: platformAdminRole.id, permissionId } },
      update: {},
      create: { roleId: platformAdminRole.id, permissionId },
    });
  }

  const platformAdminUser = await upsertUser({
    tenantId: platformTenant.id,
    roleId: platformAdminRole.id,
    email: "platform.admin@example.test",
    name: "Priya Naidoo",
  });

  // --- Demo tenant ------------------------------------------------------------
  console.log("Seeding demo tenant...");
  const demoTenant = await prisma.tenant.upsert({
    where: { slug: "acme-logistics" },
    update: {},
    create: {
      name: "Acme Logistics (Pty) Ltd",
      slug: "acme-logistics",
      timezone: "Africa/Johannesburg",
      currency: "ZAR",
    },
  });

  const siteName = "Johannesburg Distribution Centre";
  const site =
    (await prisma.site.findFirst({ where: { tenantId: demoTenant.id, name: siteName } })) ??
    (await prisma.site.create({
      data: { tenantId: demoTenant.id, name: siteName, address: "1 Fictional Way, Johannesburg" },
    }));

  const gateNames = ["Main Gate", "Yard Gate"] as const;
  for (const name of gateNames) {
    const existing = await prisma.gate.findFirst({ where: { tenantId: demoTenant.id, siteId: site.id, name } });
    if (!existing) {
      await prisma.gate.create({ data: { tenantId: demoTenant.id, siteId: site.id, name, direction: "BOTH" } });
    }
  }

  const createdUsers: { role: string; email: string }[] = [
    { role: "Platform Administrator", email: platformAdminUser.email },
  ];
  const usersByRole = new Map<string, { id: string; email: string }>();

  for (const [roleName, def] of Object.entries(TENANT_ROLE_DEFINITIONS)) {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: demoTenant.id, name: roleName } },
      update: {},
      create: { tenantId: demoTenant.id, name: roleName, description: def.description, isSystem: true },
    });

    for (const { resource, action } of def.permissions) {
      const permissionId = permissionIdByKey.get(permissionKey(resource, action));
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }

    const slug = roleName.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
    const user = await upsertUser({
      tenantId: demoTenant.id,
      roleId: role.id,
      email: `${slug}@example.test`,
      name: fictionalNameFor(roleName),
    });
    createdUsers.push({ role: roleName, email: user.email });
    usersByRole.set(roleName, { id: user.id, email: user.email });
  }

  await seedMasterData(demoTenant.id, site.id, usersByRole);

  console.log("\nSeed complete. Dev-only fictional accounts (all share the same dev password):");
  console.log(`  Password: ${DEV_PASSWORD}`);
  console.log(`  Platform tenant slug: ${platformTenant.slug}`);
  console.log(`  Demo tenant slug:     ${demoTenant.slug}`);
  for (const u of createdUsers) {
    console.log(`  - ${u.role.padEnd(24)} ${u.email}`);
  }
}

async function upsertUser(input: { tenantId: string; roleId: string; email: string; name: string }) {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);
  return prisma.user.upsert({
    where: { tenantId_email: { tenantId: input.tenantId, email: input.email } },
    update: {},
    create: {
      tenantId: input.tenantId,
      roleId: input.roleId,
      email: input.email,
      name: input.name,
      passwordHash,
      status: "ACTIVE",
    },
  });
}

function fictionalNameFor(roleName: string): string {
  const names: Record<string, string> = {
    "Company Administrator": "Thandiwe Mokoena",
    "Dispatch and Logistics Officer": "Refilwe Sekgobela",
    "Gate Security Officer": "Sipho Dlamini",
    "Security Supervisor / Approving Manager": "Johan van der Merwe",
    "Fleet and GPS Manager": "Fatima Patel",
    "Accountant / Finance and Compliance Officer": "Nomvula Khumalo",
    "Internal Investigator / Auditor": "Andries Pretorius",
    "External Reviewer": "Michael O'Sullivan",
    "Executive Read-Only Viewer": "Lindiwe Zulu",
  };
  return names[roleName] ?? roleName;
}

const TYRE_LAYOUTS: { name: string; category: "PASSENGER" | "LIGHT_COMMERCIAL" | "TRUCK" | "TRUCK_DUAL_REAR_WHEEL" | "TRAILER"; positions: { code: string; label: string }[] }[] = [
  {
    name: "Standard Passenger (4-wheel)",
    category: "PASSENGER",
    positions: [
      { code: "FL", label: "Front Left" },
      { code: "FR", label: "Front Right" },
      { code: "RL", label: "Rear Left" },
      { code: "RR", label: "Rear Right" },
    ],
  },
  {
    name: "Standard Light Commercial (4-wheel)",
    category: "LIGHT_COMMERCIAL",
    positions: [
      { code: "FL", label: "Front Left" },
      { code: "FR", label: "Front Right" },
      { code: "RL", label: "Rear Left" },
      { code: "RR", label: "Rear Right" },
    ],
  },
  {
    name: "Standard Truck (single rear wheels)",
    category: "TRUCK",
    positions: [
      { code: "FL", label: "Front Left" },
      { code: "FR", label: "Front Right" },
      { code: "RL", label: "Rear Left" },
      { code: "RR", label: "Rear Right" },
    ],
  },
  {
    name: "Truck (dual rear wheels)",
    category: "TRUCK_DUAL_REAR_WHEEL",
    positions: [
      { code: "FL", label: "Front Left" },
      { code: "FR", label: "Front Right" },
      { code: "RL_OUTER", label: "Rear Left Outer" },
      { code: "RL_INNER", label: "Rear Left Inner" },
      { code: "RR_OUTER", label: "Rear Right Outer" },
      { code: "RR_INNER", label: "Rear Right Inner" },
    ],
  },
  {
    name: "Standard Trailer (tandem axle)",
    category: "TRAILER",
    positions: [
      { code: "AXLE1_LEFT", label: "Axle 1 Left" },
      { code: "AXLE1_RIGHT", label: "Axle 1 Right" },
      { code: "AXLE2_LEFT", label: "Axle 2 Left" },
      { code: "AXLE2_RIGHT", label: "Axle 2 Right" },
    ],
  },
];

const DEFAULT_EXPIRY_RULES: { documentType: "DRIVER_LICENCE" | "PDP" | "VEHICLE_LICENCE" | "ROADWORTHY_CERTIFICATE" | "INSURANCE" | "OTHER"; action: "WARN" | "REQUIRE_SUPERVISOR_APPROVAL" | "BLOCK_CLEARANCE" }[] = [
  { documentType: "DRIVER_LICENCE", action: "BLOCK_CLEARANCE" },
  { documentType: "PDP", action: "BLOCK_CLEARANCE" },
  { documentType: "VEHICLE_LICENCE", action: "BLOCK_CLEARANCE" },
  { documentType: "ROADWORTHY_CERTIFICATE", action: "BLOCK_CLEARANCE" },
  { documentType: "INSURANCE", action: "REQUIRE_SUPERVISOR_APPROVAL" },
  { documentType: "OTHER", action: "WARN" },
];

async function seedMasterData(tenantId: string, siteId: string, usersByRole: Map<string, { id: string; email: string }>) {
  console.log("Seeding tyre-position configs, expiry rules, drivers, vehicles, movements...");

  const tyreConfigByCategory = new Map<string, string>();
  for (const layout of TYRE_LAYOUTS) {
    const config = await prisma.tyrePositionConfig.upsert({
      where: { tenantId_name: { tenantId, name: layout.name } },
      update: {},
      create: { tenantId, name: layout.name, category: layout.category, isSystem: true },
    });
    tyreConfigByCategory.set(layout.category, config.id);
    for (const [index, pos] of layout.positions.entries()) {
      await prisma.tyrePositionDefinition.upsert({
        where: { configId_code: { configId: config.id, code: pos.code } },
        update: {},
        create: { configId: config.id, code: pos.code, label: pos.label, sortOrder: index },
      });
    }
  }

  for (const rule of DEFAULT_EXPIRY_RULES) {
    await prisma.documentExpiryRule.upsert({
      where: { tenantId_documentType: { tenantId, documentType: rule.documentType } },
      update: {},
      create: { tenantId, documentType: rule.documentType, action: rule.action },
    });
  }

  const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const driver1 = await upsertDriver(tenantId, {
    employeeNumber: "EMP-1001",
    name: "Kagiso Ndlovu",
    licenceNumber: "GP1234567",
    licenceClass: "C1",
    licenceExpiry: oneYearFromNow,
    authorisedVehicleClasses: ["C1", "EC1"],
  });
  const driver2 = await upsertDriver(tenantId, {
    employeeNumber: "EMP-1002",
    name: "Palesa Mokoena",
    licenceNumber: "GP7654321",
    licenceClass: "EC",
    licenceExpiry: thirtyDaysAgo, // deliberately expired — exercises the expiry-rule display path
    pdpNumber: "PDP-99201",
    pdpExpiry: oneYearFromNow,
    authorisedVehicleClasses: ["C1", "EC", "EC1"],
  });

  const truck = await upsertVehicle(tenantId, {
    fleetNumber: "FL-100",
    registrationNumber: "JHB100GP",
    vin: "VIN0000000000TRUCK1",
    make: "Isuzu",
    model: "FTR 850",
    year: 2022,
    colour: "White",
    category: "TRUCK",
    assignedDriverId: driver1.id,
    tyrePositionConfigId: tyreConfigByCategory.get("TRUCK") ?? null,
    licenceDiscExpiry: oneYearFromNow,
    roadworthyExpiry: oneYearFromNow,
    insuranceExpiry: oneYearFromNow,
    operationalStatus: "OPERATIONAL",
  });
  const trailer = await upsertVehicle(tenantId, {
    fleetNumber: "TR-200",
    registrationNumber: "JHB200GP",
    vin: "VIN0000000TRAILER01",
    make: "SA Trailers",
    model: "Flatbed",
    year: 2020,
    colour: "Grey",
    category: "TRAILER",
    tyrePositionConfigId: tyreConfigByCategory.get("TRAILER") ?? null,
    operationalStatus: "OPERATIONAL",
  });
  await prisma.vehicle.update({ where: { id: trailer.id }, data: { attachedToVehicleId: truck.id } });

  const bakkie = await upsertVehicle(tenantId, {
    fleetNumber: "LC-300",
    registrationNumber: "JHB300GP",
    vin: "VIN0000000BAKKIE001",
    make: "Toyota",
    model: "Hilux",
    year: 2023,
    colour: "Silver",
    category: "LIGHT_COMMERCIAL",
    assignedDriverId: driver2.id,
    tyrePositionConfigId: tyreConfigByCategory.get("LIGHT_COMMERCIAL") ?? null,
    licenceDiscExpiry: oneYearFromNow,
    roadworthyExpiry: oneYearFromNow,
    insuranceExpiry: thirtyDaysAgo, // deliberately expired
    operationalStatus: "WORKSHOP_LOCKOUT", // exercises the lockout-prevents-clearance path
  });

  // Sample current tyre reference data for the truck.
  const truckPositions = await prisma.tyrePositionDefinition.findMany({
    where: { configId: tyreConfigByCategory.get("TRUCK") },
  });
  for (const pos of truckPositions) {
    await prisma.vehicleTyre.upsert({
      where: { vehicleId_positionDefinitionId: { vehicleId: truck.id, positionDefinitionId: pos.id } },
      update: {},
      create: { tenantId, vehicleId: truck.id, positionDefinitionId: pos.id, brand: "Bridgestone", size: "295/80R22.5" },
    });
  }

  const dispatchOfficer = usersByRole.get("Dispatch and Logistics Officer");
  const fleetManager = usersByRole.get("Fleet and GPS Manager");
  const securitySupervisor = usersByRole.get("Security Supervisor / Approving Manager");
  if (dispatchOfficer && fleetManager && securitySupervisor) {
    // Demo MediaAsset — driver portrait (Phase 4, real upload replaces the
    // old dev-mode Driver.portraitUrl placeholder, see DECISIONS.md D-012).
    // Captured by Fleet and GPS Manager, who owns driver master data — not
    // Dispatch and Logistics Officer, who only plans movements.
    if (!driver1.portraitMediaAssetId) {
      const portrait = await seedMediaAsset({
        tenantId,
        ownerType: "DRIVER_PORTRAIT",
        ownerId: driver1.id,
        capturedByUserId: fleetManager.id,
        fileName: "kagiso-ndlovu-portrait.jpg",
        contentType: "image/jpeg",
        contents: "Fictional demo portrait placeholder for Kagiso Ndlovu (EMP-1001) — no real image binary is committed to the repo.",
        idempotencyKey: `seed-driver-portrait-${driver1.id}`,
      });
      await prisma.driver.update({ where: { id: driver1.id }, data: { portraitMediaAssetId: portrait.id } });
    }

    await upsertMovement(tenantId, {
      siteId,
      vehicleId: truck.id,
      driverId: driver1.id,
      trailerVehicleId: trailer.id,
      movementType: "DELIVERY",
      purpose: "Scheduled stock delivery",
      destination: "Customer DC — Midrand",
      customerProjectJobReference: "JOB-4471",
      deliveryOrCollectionReference: "DN-88213",
      approvedCargoSummary: "12 pallets packaged goods, sealed",
      sealOrContainerReference: "SEAL-55291",
      requesterUserId: dispatchOfficer.id,
      approverUserId: securitySupervisor.id,
      status: "APPROVED",
      referenceCode: "MV-DEMO1",
    });
    await upsertMovement(tenantId, {
      siteId,
      vehicleId: bakkie.id,
      driverId: driver2.id,
      movementType: "COLLECTION",
      purpose: "Collect returned equipment",
      destination: "Supplier — Boksburg",
      purchaseOrderReference: "PO-33012",
      requesterUserId: dispatchOfficer.id,
      status: "SUBMITTED",
      referenceCode: "MV-DEMO2",
    });

    const driver3 = await upsertDriver(tenantId, {
      employeeNumber: "EMP-1003",
      name: "Bongani Sithole",
      licenceNumber: "GP5551234",
      licenceClass: "C1",
      licenceExpiry: oneYearFromNow,
      authorisedVehicleClasses: ["C1"],
    });
    const lightTruck = await upsertVehicle(tenantId, {
      fleetNumber: "FL-400",
      registrationNumber: "JHB400GP",
      vin: "VIN0000000LTRUCK01",
      make: "Isuzu",
      model: "NPR 400",
      year: 2021,
      colour: "White",
      category: "TRUCK",
      assignedDriverId: driver3.id,
      tyrePositionConfigId: tyreConfigByCategory.get("TRUCK") ?? null,
      licenceDiscExpiry: oneYearFromNow,
      roadworthyExpiry: oneYearFromNow,
      insuranceExpiry: oneYearFromNow,
      operationalStatus: "OPERATIONAL",
    });
    const movement3 = await upsertMovement(tenantId, {
      siteId,
      vehicleId: lightTruck.id,
      driverId: driver3.id,
      movementType: "ENTRY",
      purpose: "Site delivery — building materials",
      destination: "Main warehouse",
      deliveryOrCollectionReference: "DN-99120",
      approvedCargoSummary: "8 pallets cement, sealed",
      requesterUserId: dispatchOfficer.id,
      approverUserId: securitySupervisor.id,
      status: "APPROVED",
      referenceCode: "MV-DEMO3",
    });

    await seedGateOperations(tenantId, siteId, usersByRole, {
      exceptionMovementId: movement3.id,
      exceptionVehicleId: lightTruck.id,
      exceptionDriverId: driver3.id,
    });
  }
}

/**
 * Seeds a default configurable inspection template (build brief GATE-006),
 * a small tenant-configurable exception-type catalogue (GATE item 3), and two
 * demoable GateEvents in different states — a cleared happy-path event and an
 * event sitting in SUPERVISOR_REVIEW with an open high-severity exception —
 * so the security dashboard and gate workflow are demoable end-to-end without
 * manual setup. Writes GateEvent/Exception rows directly via Prisma (not the
 * repository layer) the same way upsertMovement already does for
 * MovementAuthorisation — seed data intentionally sets a specific target
 * state rather than replaying every intermediate transition.
 */
async function seedGateOperations(
  tenantId: string,
  siteId: string,
  usersByRole: Map<string, { id: string; email: string }>,
  refs: { exceptionMovementId: string; exceptionVehicleId: string; exceptionDriverId: string },
) {
  console.log("Seeding inspection template, exception types, and demo gate events...");

  const officer = usersByRole.get("Gate Security Officer");
  const securitySupervisor = usersByRole.get("Security Supervisor / Approving Manager");
  if (!officer || !securitySupervisor) return;

  const mainGate = await prisma.gate.findFirst({ where: { tenantId, siteId, name: "Main Gate" } });
  const yardGate = await prisma.gate.findFirst({ where: { tenantId, siteId, name: "Yard Gate" } });
  if (!mainGate || !yardGate) return;

  // --- Default configurable inspection template (generic — applies to every category) ---
  const templateName = "Standard Gate Inspection";
  let template = await prisma.inspectionTemplate.findFirst({
    where: { tenantId, name: templateName, version: 1 },
    include: { items: true },
  });
  if (!template) {
    template = await prisma.inspectionTemplate.create({
      data: {
        tenantId,
        name: templateName,
        description: "Default guided walk-around inspection covering driver, vehicle, condition and load checks.",
        vehicleCategory: null,
        version: 1,
        isActive: true,
        isSystem: true,
        items: {
          create: [
            { section: "DRIVER_AUTHORISATION", label: "Driver licence matches movement authorisation", sortOrder: 0, responseType: "CHECK", defaultExceptionSeverity: "HIGH", requiresSupervisorApprovalOnFail: true },
            { section: "DRIVER_AUTHORISATION", label: "PDP valid for this vehicle class (where required)", sortOrder: 1, responseType: "CHECK" },
            { section: "VEHICLE_IDENTITY", label: "Registration number matches approved movement", sortOrder: 0, responseType: "CHECK", defaultExceptionSeverity: "HIGH", requiresSupervisorApprovalOnFail: true },
            { section: "VEHICLE_IDENTITY", label: "VIN/chassis number visible and matches", sortOrder: 1, responseType: "CHECK" },
            { section: "EXTERIOR_CONDITION", label: "No new visible body damage", sortOrder: 0, responseType: "CHECK", defaultExceptionSeverity: "MEDIUM" },
            { section: "EXTERIOR_CONDITION", label: "Windscreen and mirrors intact", sortOrder: 1, responseType: "CHECK" },
            { section: "LIGHTS", label: "Headlights operational", sortOrder: 0, responseType: "CHECK" },
            { section: "LIGHTS", label: "Indicators and brake lights operational", sortOrder: 1, responseType: "CHECK" },
            { section: "TYRES_WHEELS", label: "Tyre tread depth (all positions)", sortOrder: 0, responseType: "READING", unit: "mm", defaultExceptionSeverity: "HIGH", requiresSupervisorApprovalOnFail: true },
            { section: "TYRES_WHEELS", label: "Tyre condition — no visible damage", sortOrder: 1, responseType: "CHECK" },
            { section: "OPERATIONAL_INFO", label: "Odometer reading recorded", sortOrder: 0, responseType: "READING", unit: "km" },
            { section: "OPERATIONAL_INFO", label: "Fuel level recorded", sortOrder: 1, responseType: "READING", unit: "%" },
            { section: "LOAD_VERIFICATION", label: "Cargo matches approved cargo summary", sortOrder: 0, responseType: "CHECK", defaultExceptionSeverity: "HIGH", requiresSupervisorApprovalOnFail: true },
            { section: "LOAD_VERIFICATION", label: "Seal/container reference matches", sortOrder: 1, responseType: "CHECK" },
          ],
        },
      },
      include: { items: true },
    });
  }

  // --- Tenant-configurable exception-type catalogue (DocumentExpiryRule-equivalent for exceptions) ---
  const exceptionTypeSpecs = [
    { code: "TYRE_CONDITION", label: "Tyre condition/tread below threshold", defaultSeverity: "HIGH" as const, defaultOutcomeAction: "SUPERVISOR_APPROVAL" as const, requiresSupervisorApproval: true },
    { code: "DAMAGE_FOUND", label: "Unexplained vehicle damage found", defaultSeverity: "HIGH" as const, defaultOutcomeAction: "WORKSHOP_LOCKOUT" as const, requiresSupervisorApproval: true },
    { code: "DOCUMENT_ISSUE", label: "Supporting document issue (not yet expired)", defaultSeverity: "MEDIUM" as const, defaultOutcomeAction: "MANUAL_REVIEW" as const, requiresSupervisorApproval: false },
    { code: "MISSING_PPE", label: "Driver missing required PPE", defaultSeverity: "LOW" as const, defaultOutcomeAction: "WARNING" as const, requiresSupervisorApproval: false },
  ];
  const exceptionTypeByCode = new Map<string, string>();
  for (const spec of exceptionTypeSpecs) {
    const row = await prisma.exceptionType.upsert({
      where: { tenantId_code: { tenantId, code: spec.code } },
      update: {},
      create: { tenantId, isSystem: true, ...spec },
    });
    exceptionTypeByCode.set(spec.code, row.id);
  }

  // --- Demo GateEvent A: cleared happy path against MV-DEMO1 (truck + trailer) ---
  const clearedMovement = await prisma.movementAuthorisation.findUnique({ where: { referenceCode: "MV-DEMO1" } });
  if (clearedMovement && clearedMovement.status === "APPROVED") {
    let gateEventA = await prisma.gateEvent.findFirst({ where: { tenantId, movementAuthorisationId: clearedMovement.id } });
    if (!gateEventA) {
      const startedAt = new Date(Date.now() - 45 * 60 * 1000);
      gateEventA = await prisma.gateEvent.create({
        data: {
          tenantId,
          siteId,
          gateId: mainGate.id,
          direction: "ENTRY",
          vehicleId: clearedMovement.vehicleId,
          trailerVehicleId: clearedMovement.trailerVehicleId,
          driverId: clearedMovement.driverId,
          movementAuthorisationId: clearedMovement.id,
          securityOfficerUserId: officer.id,
          inspectionTemplateId: template.id,
          status: "CLEARED",
          identityVerificationResult: "VERIFIED",
          identityVerificationRef: `mock-${clearedMovement.driverId}-seed`,
          identityVerifiedAt: startedAt,
          startedAt,
          decision: "CLEARED",
          decisionReason: "All checks passed.",
          decisionByUserId: officer.id,
          decisionAt: new Date(Date.now() - 20 * 60 * 1000),
        },
      });

      const readingValueByUnit: Record<string, string> = { mm: "8", km: "84213", "%": "62" };
      for (const item of template.items) {
        await prisma.gateEventInspectionItem.create({
          data: {
            tenantId,
            gateEventId: gateEventA.id,
            inspectionItemId: item.id,
            outcome: "PASS",
            readingValue: item.responseType === "READING" ? (readingValueByUnit[item.unit ?? ""] ?? "OK") : null,
            readingUnit: item.unit ?? null,
            recordedByUserId: officer.id,
          },
        });
      }

      await prisma.movementAuthorisation.update({ where: { id: clearedMovement.id }, data: { status: "IN_PROGRESS" } });
    }
  }

  // --- Demo GateEvent B: open high-severity exception awaiting supervisor review against MV-DEMO3 ---
  let gateEventB = await prisma.gateEvent.findFirst({ where: { tenantId, movementAuthorisationId: refs.exceptionMovementId } });
  if (!gateEventB) {
    const startedAt = new Date(Date.now() - 15 * 60 * 1000);
    gateEventB = await prisma.gateEvent.create({
      data: {
        tenantId,
        siteId,
        gateId: yardGate.id,
        direction: "ENTRY",
        vehicleId: refs.exceptionVehicleId,
        driverId: refs.exceptionDriverId,
        movementAuthorisationId: refs.exceptionMovementId,
        securityOfficerUserId: officer.id,
        inspectionTemplateId: template.id,
        status: "SUPERVISOR_REVIEW",
        identityVerificationResult: "VERIFIED",
        identityVerificationRef: `mock-${refs.exceptionDriverId}-seed`,
        identityVerifiedAt: startedAt,
        startedAt,
      },
    });

    const tyreItem = template.items.find((i) => i.label.startsWith("Tyre tread depth"));
    if (tyreItem) {
      const inspectionResult = await prisma.gateEventInspectionItem.create({
        data: {
          tenantId,
          gateEventId: gateEventB.id,
          inspectionItemId: tyreItem.id,
          outcome: "FAIL",
          readingValue: "1.2",
          readingUnit: "mm",
          comment: "Rear-left tyre below minimum legal tread depth.",
          exceptionSeverity: "HIGH",
          supervisorApprovalRequired: true,
          recordedByUserId: officer.id,
        },
      });

      await prisma.exception.create({
        data: {
          tenantId,
          gateEventId: gateEventB.id,
          inspectionResultId: inspectionResult.id,
          exceptionTypeId: exceptionTypeByCode.get("TYRE_CONDITION"),
          description: "Rear-left tyre tread depth (1.2mm) is below the legal/safety minimum.",
          severity: "HIGH",
          requiresSupervisorApproval: true,
          raisedByUserId: officer.id,
        },
      });
    }
  }

  // Demo MediaAsset — evidence photo for the failed tyre-tread inspection
  // item on gateEventB (Phase 4, real upload replaces the old dev-mode
  // GateEventInspectionItem.evidenceRef placeholder — see DECISIONS.md
  // D-012). Kept outside the `if (!gateEventB)` block above so it still
  // backfills onto an already-seeded gateEventB from a prior session, not
  // just a freshly created one — same idempotent-by-lookup approach as the
  // rest of this seed script.
  const tyreItemForEvidence = template.items.find((i) => i.label.startsWith("Tyre tread depth"));
  if (tyreItemForEvidence) {
    const inspectionResultForEvidence = await prisma.gateEventInspectionItem.findUnique({
      where: { gateEventId_inspectionItemId: { gateEventId: gateEventB.id, inspectionItemId: tyreItemForEvidence.id } },
    });
    if (inspectionResultForEvidence && !inspectionResultForEvidence.evidenceMediaAssetId) {
      const tyreEvidence = await seedMediaAsset({
        tenantId,
        ownerType: "GATE_EVENT_INSPECTION_ITEM",
        ownerId: gateEventB.id,
        capturedByUserId: officer.id,
        fileName: "rear-left-tyre-tread.jpg",
        contentType: "image/jpeg",
        contents: "Fictional demo evidence placeholder — rear-left tyre tread depth photo for the seeded SUPERVISOR_REVIEW gate event.",
        idempotencyKey: `seed-gate-event-evidence-${gateEventB.id}`,
      });
      await prisma.gateEventInspectionItem.update({
        where: { id: inspectionResultForEvidence.id },
        data: { evidenceMediaAssetId: tyreEvidence.id },
      });
    }
  }
}

async function upsertDriver(
  tenantId: string,
  data: {
    employeeNumber: string;
    name: string;
    licenceNumber: string;
    licenceClass: string;
    licenceExpiry: Date;
    pdpNumber?: string;
    pdpExpiry?: Date;
    authorisedVehicleClasses: string[];
  },
) {
  const existing = await prisma.driver.findFirst({ where: { tenantId, employeeNumber: data.employeeNumber } });
  if (existing) return existing;
  return prisma.driver.create({ data: { tenantId, status: "ACTIVE", ...data } });
}

async function upsertVehicle(
  tenantId: string,
  data: {
    fleetNumber: string;
    registrationNumber: string;
    vin: string;
    make: string;
    model: string;
    year: number;
    colour: string;
    category: "PASSENGER" | "LIGHT_COMMERCIAL" | "TRUCK" | "TRUCK_DUAL_REAR_WHEEL" | "TRAILER" | "CUSTOM";
    assignedDriverId?: string;
    tyrePositionConfigId: string | null;
    licenceDiscExpiry?: Date;
    roadworthyExpiry?: Date;
    insuranceExpiry?: Date;
    operationalStatus: "OPERATIONAL" | "WORKSHOP_LOCKOUT" | "SECURITY_LOCKOUT" | "DECOMMISSIONED";
  },
) {
  const existing = await prisma.vehicle.findFirst({ where: { tenantId, registrationNumber: data.registrationNumber } });
  if (existing) return existing;
  return prisma.vehicle.create({ data: { tenantId, ...data } });
}

async function upsertMovement(
  tenantId: string,
  data: {
    siteId: string;
    vehicleId: string;
    driverId: string;
    trailerVehicleId?: string;
    movementType: "ENTRY" | "EXIT" | "DELIVERY" | "COLLECTION" | "RETURN" | "SITE_TRANSFER" | "MAINTENANCE" | "OTHER";
    purpose?: string;
    destination?: string;
    customerProjectJobReference?: string;
    deliveryOrCollectionReference?: string;
    purchaseOrderReference?: string;
    approvedCargoSummary?: string;
    sealOrContainerReference?: string;
    requesterUserId: string;
    approverUserId?: string;
    status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "IN_PROGRESS" | "COMPLETED";
    referenceCode: string;
  },
) {
  const existing = await prisma.movementAuthorisation.findUnique({ where: { referenceCode: data.referenceCode } });
  if (existing) return existing;
  return prisma.movementAuthorisation.create({ data: { tenantId, ...data } });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
