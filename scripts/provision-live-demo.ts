/**
 * Provisions (or cleans up) one narrowly-scoped synthetic demonstration
 * tenant — "Genbridge Demonstration Logistics" — directly in the live
 * production database, for Mohammed's customer demonstration. See
 * DEMO_TOMORROW_RUNBOOK.md and WORKLOG.md 2026-08-25 for the full record.
 *
 * Deliberately NOT npm run seed: that script creates fictional accounts
 * sharing one publicly-known password and refuses to run anywhere but a
 * local database (src/lib/db/seed-guard.ts) — the opposite posture from
 * what's needed here. This script:
 *   - only ever touches its own fixed-identity demo tenant (never another),
 *   - requires an explicit confirmation env var for both create and cleanup,
 *   - is idempotent: reruns detect the existing tenant and no-op rather than
 *     duplicating records,
 *   - never truncates, resets or deletes anything outside that one tenant,
 *   - generates a random per-run password and writes it only to a
 *     git-ignored local file, never to stdout/logs.
 *
 * Usage:
 *   LIVE_SYNTHETIC_DEMO_CONFIRMATION=CREATE_GENBRIDGE_SYNTHETIC_DEMO \
 *     npx tsx scripts/provision-live-demo.ts create
 *   npx tsx scripts/provision-live-demo.ts verify
 *   LIVE_SYNTHETIC_DEMO_CLEANUP_CONFIRMATION=DELETE_GENBRIDGE_SYNTHETIC_DEMO \
 *     npx tsx scripts/provision-live-demo.ts cleanup
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { listAllPermissions, permissionKey } from "../src/lib/auth/permissions";
import { TENANT_ROLE_DEFINITIONS } from "../src/lib/auth/tenant-role-definitions";
import { SYNTHETIC_BIOMETRIC_LABEL } from "../src/lib/facial-verification/contracts";
import {
  LIVE_DEMO_TENANT_ID,
  LIVE_DEMO_TENANT_SLUG,
  LIVE_DEMO_TENANT_NAME,
  assertLiveDemoCreateConfirmed,
  assertLiveDemoCleanupConfirmed,
  assertLiveDemoTenantIdentity,
  assertNotTestDatabase,
  liveDemoEmail,
} from "../src/lib/live-demo/live-demo-safety";

const DEMO_ROLES = [
  "Company Administrator",
  "Dispatch and Logistics Officer",
  "Gate Security Officer",
  "Security Supervisor / Approving Manager",
  "Fleet and GPS Manager",
  "Executive Read-Only Viewer",
] as const;

const ENVIRONMENT_LABEL = "SYNTHETIC CUSTOMER DEMONSTRATION";
const NOW = () => new Date();

function id(kind: string, suffix: string | number): string {
  return `live-demo-${kind}-${suffix}`;
}

function createClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  assertNotTestDatabase(databaseUrl);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

async function provisionDemoTenant(prisma: PrismaClient): Promise<{ created: boolean; password?: string }> {
  const existing = await prisma.tenant.findUnique({ where: { slug: LIVE_DEMO_TENANT_SLUG }, select: { id: true, slug: true, name: true } });
  if (existing) {
    assertLiveDemoTenantIdentity(existing);
    console.log(`[provision-live-demo] Already provisioned (tenant ${existing.id}); no changes made. Run "verify" to see current counts.`);
    return { created: false };
  }

  // Global permission catalogue is not tenant-scoped — safe to upsert
  // unconditionally, matching prisma/seed.ts's own idempotent pattern.
  console.log("[provision-live-demo] Ensuring the global permission catalogue exists...");
  const permissionRows = await Promise.all(
    listAllPermissions().map(({ resource, action }) =>
      prisma.permission.upsert({ where: { resource_action: { resource, action } }, update: {}, create: { resource, action } }),
    ),
  );
  const permissionIdByKey = new Map(permissionRows.map((p) => [permissionKey(p.resource, p.action), p.id]));

  const password = crypto.randomBytes(24).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 12);
  const now = NOW();

  console.log(`[provision-live-demo] Creating tenant ${LIVE_DEMO_TENANT_ID} (${LIVE_DEMO_TENANT_SLUG}) in one transaction...`);
  await prisma.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          id: LIVE_DEMO_TENANT_ID,
          slug: LIVE_DEMO_TENANT_SLUG,
          name: LIVE_DEMO_TENANT_NAME,
          timezone: "Africa/Johannesburg",
          subscriptionStatus: "TRIAL",
          companyRegistrationNumber: "SYNTHETIC-DEMO-0002",
          industry: `${ENVIRONMENT_LABEL} — Logistics`,
          contactEmail: liveDemoEmail("admin"),
          contactPhone: "+27 00 000 0000",
          address: `${ENVIRONMENT_LABEL} — 1 Example Business Park, Sandton, Johannesburg`,
          departments: ["Distribution", "Service Operations", "Sales"],
          demoWorkspace: true,
          demoTermsAcceptedAt: now,
          demoDisclosureVersion: "live-demo-2026-08-v1",
        },
      });

      // --- Roles + permissions (reusing the canonical grants) -------------
      const roleIdByName = new Map<string, string>();
      for (const roleName of DEMO_ROLES) {
        const def = TENANT_ROLE_DEFINITIONS[roleName];
        if (!def) throw new Error(`No canonical permission definition for role "${roleName}".`);
        const role = await tx.role.create({
          data: { id: id("role", roleName.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")), tenantId: tenant.id, name: roleName, description: def.description, isSystem: true },
        });
        roleIdByName.set(roleName, role.id);
        const rolePermissionData = def.permissions
          .map(({ resource, action }) => permissionIdByKey.get(permissionKey(resource, action)))
          .filter((permissionId): permissionId is string => Boolean(permissionId))
          .map((permissionId) => ({ roleId: role.id, permissionId }));
        if (rolePermissionData.length) await tx.rolePermission.createMany({ data: rolePermissionData });
      }

      // --- Users ------------------------------------------------------------
      const userSpecs = [
        { local: "admin", role: "Company Administrator", name: "Demo Company Administrator" },
        { local: "dispatch", role: "Dispatch and Logistics Officer", name: "Demo Dispatch and Logistics Officer" },
        { local: "guard", role: "Gate Security Officer", name: "Demo Gate Security Officer" },
        { local: "manager", role: "Security Supervisor / Approving Manager", name: "Demo Security Supervisor / Approving Manager" },
        { local: "fleet", role: "Fleet and GPS Manager", name: "Demo Fleet and GPS Manager" },
        { local: "executive", role: "Executive Read-Only Viewer", name: "Demo Executive Read-Only Viewer" },
      ] as const;
      const userIdByRole = new Map<string, string>();
      for (const spec of userSpecs) {
        const user = await tx.user.create({
          data: {
            id: id("user", spec.local),
            tenantId: tenant.id,
            roleId: roleIdByName.get(spec.role)!,
            email: liveDemoEmail(spec.local),
            name: spec.name,
            employeeNumber: `DEMO-${spec.local.toUpperCase()}`,
            status: "ACTIVE",
            approvalStatus: spec.role === "Gate Security Officer" ? "APPROVED" : "NOT_REQUIRED",
            passwordHash,
          },
        });
        userIdByRole.set(spec.role, user.id);
      }
      const admin = userIdByRole.get("Company Administrator")!;
      const dispatch = userIdByRole.get("Dispatch and Logistics Officer")!;
      const officer = userIdByRole.get("Gate Security Officer")!;
      const manager = userIdByRole.get("Security Supervisor / Approving Manager")!;
      const fleetManager = userIdByRole.get("Fleet and GPS Manager")!;

      // --- Sites + gates (entrance and exit per site) -----------------------
      const central = await tx.site.create({ data: { id: id("site", "central"), tenantId: tenant.id, name: "Central Distribution Depot", address: `${ENVIRONMENT_LABEL} — 1 Example Business Park, Sandton, Johannesburg` } });
      const northern = await tx.site.create({ data: { id: id("site", "northern"), tenantId: tenant.id, name: "Northern Regional Depot", address: `${ENVIRONMENT_LABEL} — 45 Example Logistics Road, Midrand` } });
      const centralEntrance = await tx.gate.create({ data: { id: id("gate", "central-entrance"), tenantId: tenant.id, siteId: central.id, name: "Central Depot Entrance Gate", direction: "ENTRY" } });
      const centralExit = await tx.gate.create({ data: { id: id("gate", "central-exit"), tenantId: tenant.id, siteId: central.id, name: "Central Depot Exit Gate", direction: "EXIT" } });
      const northernEntrance = await tx.gate.create({ data: { id: id("gate", "northern-entrance"), tenantId: tenant.id, siteId: northern.id, name: "Northern Depot Entrance Gate", direction: "ENTRY" } });
      const northernExit = await tx.gate.create({ data: { id: id("gate", "northern-exit"), tenantId: tenant.id, siteId: northern.id, name: "Northern Depot Exit Gate", direction: "EXIT" } });

      await tx.user.update({ where: { id: officer }, data: { assignedSiteId: central.id, assignedGateId: centralEntrance.id, approvedByUserId: manager } });
      // Second, unapproved guard — demonstrates the pending-approval state.
      const pendingGuardRole = roleIdByName.get("Gate Security Officer")!;
      const pendingGuard = await tx.user.create({
        data: {
          id: id("user", "guard-pending"), tenantId: tenant.id, roleId: pendingGuardRole,
          email: liveDemoEmail("guard.pending"), name: "Demo Pending Gate Security Officer",
          employeeNumber: "DEMO-GUARD-PENDING", status: "ACTIVE", approvalStatus: "PENDING",
          assignedSiteId: northern.id, assignedGateId: northernEntrance.id, passwordHash,
        },
      });

      // --- Drivers (10) ------------------------------------------------------
      // Ratings are computed dynamically by calculateDriverGovernanceRating
      // (src/lib/ratings/driver-rating.ts) from these fields plus linked
      // exception/inspection counts below — nothing here stores a rating
      // directly. Score bands: >=80 good standing, 50-79 review required,
      // <50 serious attention.
      const farFuture = new Date("2029-06-30T00:00:00.000Z");
      const driverSpecs = [
        // Four green — clean records, currently assigned.
        { n: 1, name: "Demo Driver — Thabo Nkosi", dept: "Distribution", employeeNumber: "DEMO-D001", contact: true, licenceExpiry: farFuture, pdpStatus: "VALID" as const, pdpExpiry: farFuture, note: "Valid documents and no open exceptions." },
        { n: 2, name: "Demo Driver — Naledi Dube", dept: "Distribution", employeeNumber: "DEMO-D002", contact: true, licenceExpiry: farFuture, pdpStatus: "VALID" as const, pdpExpiry: farFuture, note: "Valid documents and no open exceptions." },
        { n: 3, name: "Demo Driver — Kagiso Molefe", dept: "Distribution", employeeNumber: "DEMO-D003", contact: true, licenceExpiry: farFuture, pdpStatus: "VALID" as const, pdpExpiry: farFuture, note: "Valid documents and no open exceptions." },
        { n: 4, name: "Demo Driver — Zanele Ngcobo", dept: "Distribution", employeeNumber: "DEMO-D004", contact: true, licenceExpiry: farFuture, pdpStatus: "VALID" as const, pdpExpiry: farFuture, note: "Valid documents and no open exceptions." },
        // Three yellow — review required, each for a distinct explainable reason.
        { n: 5, name: "Demo Driver — Bongani Mahlangu", dept: "Distribution", employeeNumber: "DEMO-D005", contact: true, licenceExpiry: daysFromNow(20), pdpStatus: "VALID" as const, pdpExpiry: daysFromNow(30), note: "Licence and professional permit both approaching expiry within 45 days." },
        { n: 6, name: "Demo Driver — Precious Khoza", dept: "Service Operations", employeeNumber: null, contact: false, licenceExpiry: farFuture, pdpStatus: "PENDING" as const, pdpExpiry: null, note: "Employee number and contact details are missing, and the professional permit status is under review — incomplete supporting documentation." },
        { n: 7, name: "Demo Driver — Sibusiso Zwane", dept: "Service Operations", employeeNumber: "DEMO-D007", contact: false, licenceExpiry: farFuture, pdpStatus: "VALID" as const, pdpExpiry: farFuture, note: "Two overdue/failed inspection items and incomplete contact details." },
        // Two red — serious attention, each combining a headline factor with a supporting one.
        { n: 8, name: "Demo Driver — Andile Cele", dept: "Distribution", employeeNumber: "DEMO-D008", contact: true, licenceExpiry: daysFromNow(-10), pdpStatus: "EXPIRED" as const, pdpExpiry: daysFromNow(-40), note: "Driving licence and professional permit have both expired." },
        { n: 9, name: "Demo Driver — Refilwe Sithole", dept: "Sales", employeeNumber: null, contact: false, licenceExpiry: daysFromNow(15), pdpStatus: "VALID" as const, pdpExpiry: farFuture, note: "Two open high-severity exceptions plus missing employee number and contact details." },
        // One unassigned — deliberately otherwise clean, to show that lacking
        // an assignment alone does not by itself cause a poor rating.
        { n: 10, name: "Demo Driver — Karabo Sekhukhune", dept: "Distribution", employeeNumber: "DEMO-D010", contact: true, licenceExpiry: farFuture, pdpStatus: "NOT_REQUIRED" as const, pdpExpiry: null, note: "Currently unassigned to a vehicle; documents otherwise valid." },
      ];
      const driverIds: string[] = [];
      for (const spec of driverSpecs) {
        const driver = await tx.driver.create({
          data: {
            id: id("driver", spec.n), tenantId: tenant.id, employeeNumber: spec.employeeNumber,
            name: spec.name, contactEmail: spec.contact ? liveDemoEmail(`driver${spec.n}`) : null, contactPhone: spec.contact ? "+27 00 000 0000" : null,
            department: spec.dept, licenceNumber: `DEMO-LIC-${String(spec.n).padStart(4, "0")}`, licenceClass: spec.n <= 4 ? "EC" : "C1",
            licenceIssueDate: new Date("2022-01-15T00:00:00.000Z"), licenceExpiry: spec.licenceExpiry,
            pdpNumber: spec.pdpStatus === "NOT_REQUIRED" ? null : `DEMO-PDP-${String(spec.n).padStart(4, "0")}`,
            pdpStatus: spec.pdpStatus, pdpExpiry: spec.pdpExpiry,
            authorisedVehicleClasses: [spec.n <= 4 ? "TRUCK" : "LIGHT_COMMERCIAL"],
            restrictions: `${ENVIRONMENT_LABEL} — not a real person`, notes: spec.note, facialVerificationEnrolled: false,
          },
        });
        driverIds.push(driver.id);
      }

      // --- Vehicles (12) -------------------------------------------------
      const vehicleSpecs = [
        { key: "DEMO-TRK-001", category: "TRUCK" as const, tonnes: 8, model: "Heavy Truck 8T", driverIdx: 0 },
        { key: "DEMO-TRK-002", category: "TRUCK" as const, tonnes: 14, model: "Heavy Truck 14T", driverIdx: 1 },
        { key: "DEMO-TRK-003", category: "TRUCK" as const, tonnes: 20, model: "Heavy Truck 20T", driverIdx: 2, review: true },
        { key: "DEMO-DEL-001", category: "TRUCK" as const, tonnes: 4, model: "Medium Delivery Truck", driverIdx: 3 },
        { key: "DEMO-DEL-002", category: "TRUCK" as const, tonnes: 4, model: "Medium Delivery Truck", driverIdx: 4, maintenance: true },
        { key: "DEMO-BAKKIE-001", category: "BAKKIE_PICKUP" as const, tonnes: null, model: "Bakkie / Pickup", driverIdx: 5 },
        { key: "DEMO-BAKKIE-002", category: "BAKKIE_PICKUP" as const, tonnes: null, model: "Bakkie / Pickup", driverIdx: 6 },
        { key: "DEMO-VAN-001", category: "VAN" as const, tonnes: null, model: "Panel Van", driverIdx: 7 },
        { key: "DEMO-SALES-001", category: "SALES_REPRESENTATIVE" as const, tonnes: null, model: "Sales Representative Hatchback", driverIdx: 8, expiringLicenceDisc: true },
        { key: "DEMO-SALES-002", category: "SALES_REPRESENTATIVE" as const, tonnes: null, model: "Sales Representative Hatchback", driverIdx: null },
        { key: "DEMO-POOL-001", category: "PASSENGER" as const, tonnes: null, model: "Passenger Pool Vehicle", driverIdx: null },
        { key: "DEMO-TRAILER-001", category: "TRAILER" as const, tonnes: null, model: "Flatbed Trailer", driverIdx: null },
      ];
      const vehicleIds: string[] = [];
      const vehicleIdByKey = new Map<string, string>();
      for (const [index, spec] of vehicleSpecs.entries()) {
        const isTrailer = spec.category === "TRAILER";
        const vehicle = await tx.vehicle.create({
          data: {
            id: id("vehicle", index + 1), tenantId: tenant.id, fleetNumber: spec.key, registrationNumber: `${spec.key}-GP`,
            vin: `DEMOVIN${String(index + 1).padStart(6, "0")}`, make: "Demo Fleet Motors", model: spec.model, year: 2024, colour: "White",
            category: spec.category, ownership: "OWNED", fuelType: isTrailer ? null : "DIESEL", department: spec.key.startsWith("DEMO-SALES") ? "Sales" : "Distribution",
            carryingCapacityTonnes: spec.tonnes, tankCapacityLitres: isTrailer ? null : 80, odometerReading: isTrailer ? null : 15000 + index * 500,
            serviceIntervalKm: isTrailer ? null : 15000, nextServiceOdometer: isTrailer ? null : 30000, nextServiceDate: new Date("2027-03-01T00:00:00.000Z"),
            fuelLevelPercent: isTrailer ? null : 70, assignedDriverId: spec.driverIdx === null ? null : driverIds[spec.driverIdx],
            licenceDiscExpiry: spec.expiringLicenceDisc ? daysFromNow(18) : new Date("2028-12-31T00:00:00.000Z"),
            roadworthyExpiry: new Date("2028-06-30T00:00:00.000Z"), insuranceExpiry: new Date("2028-09-30T00:00:00.000Z"),
            gpsProvider: isTrailer ? null : "synthetic", gpsDeviceReference: isTrailer ? null : `DEMO-TRACK-${index + 1}`, gpsStatus: isTrailer ? "UNKNOWN" : "ACTIVE",
            gpsLastCommunicationAt: isTrailer ? null : now,
            baselineConditionNotes: `${ENVIRONMENT_LABEL} — no real asset`,
            operationalStatus: spec.maintenance ? "WORKSHOP_LOCKOUT" : "OPERATIONAL",
          },
        });
        vehicleIds.push(vehicle.id);
        vehicleIdByKey.set(spec.key, vehicle.id);
      }

      await tx.driverVehicleAssignment.createMany({
        data: vehicleSpecs
          .map((spec, index) => ({ spec, vehicleId: vehicleIds[index] }))
          .filter(({ spec }) => spec.driverIdx !== null)
          .map(({ spec, vehicleId }, order) => ({
            id: id("assignment", order + 1), tenantId: tenant.id, driverId: driverIds[spec.driverIdx as number], vehicleId,
            effectiveFrom: new Date(now.getTime() - (30 - order) * 86_400_000), status: "ACTIVE", reason: "Deterministic synthetic demo fleet allocation.", assignedByUserId: admin,
          })),
      });

      // --- Compliance documents (licence/PDP-expiry warnings on dashboards) --
      for (const [index, driverId] of driverIds.entries()) {
        const spec = driverSpecs[index];
        await tx.complianceDocument.create({
          data: {
            id: id("document", `driver-${driverId}`), tenantId: tenant.id, ownerType: "DRIVER", driverId,
            documentType: "DRIVER_LICENCE", documentNumber: `DEMO-${spec.employeeNumber ?? `MISSING-${index + 1}`}`, issuer: "Synthetic Demo Licensing Authority",
            expiryDate: spec.licenceExpiry, verificationStatus: "VERIFIED", verifiedById: admin, verifiedAt: now, notes: `${ENVIRONMENT_LABEL} — no real attachment.`,
          },
        });
      }
      for (const [index, vehicleId] of vehicleIds.entries()) {
        const spec = vehicleSpecs[index];
        await tx.complianceDocument.create({
          data: {
            id: id("document", `vehicle-${vehicleId}`), tenantId: tenant.id, ownerType: "VEHICLE", vehicleId,
            documentType: "VEHICLE_LICENCE", documentNumber: `DEMO-${spec.key}`, issuer: "Synthetic Demo Licensing Authority",
            expiryDate: spec.expiringLicenceDisc ? daysFromNow(18) : new Date("2028-12-31T00:00:00.000Z"),
            verificationStatus: "VERIFIED", verifiedById: admin, verifiedAt: now, notes: `${ENVIRONMENT_LABEL} — no real attachment.`,
          },
        });
      }

      // --- Tracker mappings (labelled synthetic; no real provider implied) --
      await tx.trackerVehicleMapping.createMany({
        data: vehicleIds.slice(0, 9).map((vehicleId, offset) => ({
          id: id("tracker-mapping", offset + 1), tenantId: tenant.id, vehicleId, providerId: "synthetic", providerAssetId: `DEMO-TRACK-${offset + 1}`,
          source: "SYNTHETIC", effectiveFrom: now, reason: "Deterministic synthetic demo mapping; no real tracker provider is connected.", createdByUserId: admin,
        })),
      });
      await tx.telematicsEvent.create({
        data: {
          id: id("telematics", "current"), tenantId: tenant.id, vehicleId: vehicleIds[0], source: "SYNTHETIC",
          latitude: -26.1076, longitude: 28.0567, speedKmh: 0, ignitionOn: false, odometerKm: 15000, recordedAt: now,
          providerReference: "DEMO-SYNTHETIC-CURRENT", trackerMappingId: id("tracker-mapping", 1), providerId: "synthetic", providerEventId: "demo-current",
          collectionMethod: "SIMULATOR", receivedAt: now, normalizedAt: now, freshness: "FRESH", mappingState: "MAPPED",
          confidenceLimitations: "Synthetic fixture; not observed from a real vehicle. No live tracker provider (Netstar/Ctrack/MiX Powerfleet) is connected.", isSynthetic: true,
        },
      });

      // --- Inspection template / exception types -----------------------------
      const template = await tx.inspectionTemplate.create({ data: { id: id("inspection", "template"), tenantId: tenant.id, name: "Demo Gate Inspection", description: `${ENVIRONMENT_LABEL} checklist`, isSystem: true } });
      const conditionItem = await tx.inspectionItem.create({ data: { id: id("inspection", "condition"), templateId: template.id, section: "EXTERIOR_CONDITION", label: "Exterior condition", sortOrder: 1, defaultExceptionSeverity: "HIGH", requiresSupervisorApprovalOnFail: true } });
      const cargoItem = await tx.inspectionItem.create({ data: { id: id("inspection", "cargo"), templateId: template.id, section: "LOAD_VERIFICATION", label: "Cargo and equipment", sortOrder: 2, defaultExceptionSeverity: "HIGH", requiresSupervisorApprovalOnFail: true } });
      const conditionType = await tx.exceptionType.create({ data: { id: id("exception-type", "condition"), tenantId: tenant.id, code: "DEMO_CONDITION", label: "Synthetic vehicle-condition finding", defaultSeverity: "HIGH", defaultOutcomeAction: "WORKSHOP_LOCKOUT", requiresSupervisorApproval: true, isSystem: true } });

      // --- Movements + gate events (departure/return demonstration) ----------
      const movementNormal = await tx.movementAuthorisation.create({
        data: {
          id: id("movement", "normal"), tenantId: tenant.id, siteId: central.id, vehicleId: vehicleIds[0], driverId: driverIds[0],
          movementType: "DELIVERY", purpose: `${ENVIRONMENT_LABEL} SCENARIO: normal delivery`, destination: "Synthetic Customer, Example Test District",
          expectedDepartureAt: new Date(now.getTime() - 4 * 3_600_000), expectedReturnAt: new Date(now.getTime() + 2 * 3_600_000), expectedDistanceKm: 60,
          approvedCargoSummary: "Synthetic sealed test cargo", senderName: "Demo Dispatch", recipientName: "Synthetic Recipient",
          referenceCode: "DEMOMOV001", requesterUserId: dispatch, approverUserId: manager, status: "COMPLETED", approvalComments: "Approved for demo rehearsal only.",
        },
      });
      const movementException = await tx.movementAuthorisation.create({
        data: {
          id: id("movement", "exception"), tenantId: tenant.id, siteId: central.id, vehicleId: vehicleIds[2], driverId: driverIds[8],
          movementType: "COLLECTION", purpose: `${ENVIRONMENT_LABEL} SCENARIO: return with condition finding`, destination: "Synthetic Customer, Example Test District",
          expectedDepartureAt: new Date(now.getTime() - 5 * 3_600_000), expectedReturnAt: new Date(now.getTime() + 1 * 3_600_000), expectedDistanceKm: 90,
          approvedCargoSummary: "Synthetic sealed test cargo", senderName: "Demo Dispatch", recipientName: "Synthetic Recipient",
          referenceCode: "DEMOMOV002", requesterUserId: dispatch, approverUserId: manager, status: "IN_PROGRESS", approvalComments: "Approved for demo rehearsal only.",
        },
      });

      const departureNormal = await tx.gateEvent.create({
        data: {
          id: id("gate-event", "normal-out"), tenantId: tenant.id, siteId: central.id, gateId: centralExit.id, direction: "EXIT",
          vehicleId: vehicleIds[0], driverId: driverIds[0], movementAuthorisationId: movementNormal.id, securityOfficerUserId: officer, inspectionTemplateId: template.id,
          status: "COMPLETED", identityVerificationResult: "SYNTHETIC_MANUAL_VERIFIED", identityVerifiedAt: new Date(now.getTime() - 4 * 3_600_000),
          startedAt: new Date(now.getTime() - 4 * 3_600_000), completedAt: new Date(now.getTime() - 3.8 * 3_600_000),
          decision: "CLEARED", decisionByUserId: officer, decisionAt: new Date(now.getTime() - 3.8 * 3_600_000), decisionReason: "Departure checks complete.",
        },
      });
      const returnNormal = await tx.gateEvent.create({
        data: {
          id: id("gate-event", "normal-in"), tenantId: tenant.id, siteId: central.id, gateId: centralEntrance.id, direction: "ENTRY",
          vehicleId: vehicleIds[0], driverId: driverIds[0], movementAuthorisationId: movementNormal.id, securityOfficerUserId: officer, inspectionTemplateId: template.id,
          status: "COMPLETED", identityVerificationResult: "SYNTHETIC_MANUAL_VERIFIED", identityVerifiedAt: new Date(now.getTime() + 1.9 * 3_600_000),
          startedAt: new Date(now.getTime() + 1.9 * 3_600_000), completedAt: new Date(now.getTime() + 2 * 3_600_000),
          decision: "CLEARED", decisionByUserId: officer, decisionAt: new Date(now.getTime() + 2 * 3_600_000), decisionReason: "Return checks complete.",
        },
      });
      await tx.gateEventInspectionItem.createMany({
        data: [
          { id: id("inspection-result", "normal-out-condition"), tenantId: tenant.id, gateEventId: departureNormal.id, inspectionItemId: conditionItem.id, outcome: "PASS", recordedByUserId: officer, recordedAt: departureNormal.completedAt! },
          { id: id("inspection-result", "normal-in-condition"), tenantId: tenant.id, gateEventId: returnNormal.id, inspectionItemId: conditionItem.id, outcome: "PASS", recordedByUserId: officer, recordedAt: returnNormal.completedAt! },
        ],
      });

      const departureException = await tx.gateEvent.create({
        data: {
          id: id("gate-event", "exception-out"), tenantId: tenant.id, siteId: central.id, gateId: centralExit.id, direction: "EXIT",
          vehicleId: vehicleIds[2], driverId: driverIds[8], movementAuthorisationId: movementException.id, securityOfficerUserId: officer, inspectionTemplateId: template.id,
          status: "COMPLETED", identityVerificationResult: "SYNTHETIC_MANUAL_VERIFIED", identityVerifiedAt: new Date(now.getTime() - 5 * 3_600_000),
          startedAt: new Date(now.getTime() - 5 * 3_600_000), completedAt: new Date(now.getTime() - 4.8 * 3_600_000),
          decision: "CLEARED", decisionByUserId: officer, decisionAt: new Date(now.getTime() - 4.8 * 3_600_000), decisionReason: "Departure checks complete.",
        },
      });
      const returnException = await tx.gateEvent.create({
        data: {
          id: id("gate-event", "exception-in"), tenantId: tenant.id, siteId: central.id, gateId: centralEntrance.id, direction: "ENTRY",
          vehicleId: vehicleIds[2], driverId: driverIds[8], movementAuthorisationId: movementException.id, securityOfficerUserId: officer, inspectionTemplateId: template.id,
          status: "DENIED", identityVerificationResult: "SYNTHETIC_MANUAL_VERIFIED", identityVerifiedAt: new Date(now.getTime() + 0.9 * 3_600_000),
          startedAt: new Date(now.getTime() + 0.9 * 3_600_000), completedAt: new Date(now.getTime() + 1 * 3_600_000),
          decision: "DENIED", decisionByUserId: manager, decisionAt: new Date(now.getTime() + 1 * 3_600_000), decisionReason: "Synthetic safety finding requires corrective action.",
        },
      });
      const conditionResult = await tx.gateEventInspectionItem.create({
        data: { id: id("inspection-result", "exception-in-condition"), tenantId: tenant.id, gateEventId: returnException.id, inspectionItemId: conditionItem.id, outcome: "FAIL", comment: "Synthetic tyre-sidewall defect observed.", exceptionSeverity: "HIGH", supervisorApprovalRequired: true, recordedByUserId: officer, recordedAt: returnException.completedAt! },
      });
      const cargoResultFail1 = await tx.gateEventInspectionItem.create({
        data: { id: id("inspection-result", "exception-in-cargo-1"), tenantId: tenant.id, gateEventId: returnException.id, inspectionItemId: cargoItem.id, outcome: "FAIL", comment: "Synthetic cargo count did not match departure record (rehearsal 1).", exceptionSeverity: "HIGH", supervisorApprovalRequired: true, recordedByUserId: officer, recordedAt: returnException.completedAt! },
      });
      const cargoResultFail2 = await tx.gateEventInspectionItem.create({
        data: { id: id("inspection-result", "exception-in-cargo-2"), tenantId: tenant.id, gateEventId: departureException.id, inspectionItemId: cargoItem.id, outcome: "FAIL", comment: "Synthetic cargo count did not match departure record (rehearsal 2).", exceptionSeverity: "HIGH", supervisorApprovalRequired: true, recordedByUserId: officer, recordedAt: departureException.completedAt! },
      });

      // Resolved exception (driver 3 / vehicle under review) — satisfies the
      // "one resolved exception" requirement and demonstrates the workflow.
      const resolvedException = await tx.exception.create({
        data: { id: id("exception", "resolved"), tenantId: tenant.id, gateEventId: returnException.id, inspectionResultId: conditionResult.id, exceptionTypeId: conditionType.id, description: "Synthetic safety finding; vehicle held for authorised correction.", severity: "HIGH", requiresSupervisorApproval: true, outcomeAction: "WORKSHOP_LOCKOUT", raisedByUserId: officer, raisedAt: now },
      });
      await tx.exception.update({ where: { id: resolvedException.id }, data: { resolvedByUserId: manager, resolvedAt: new Date(now.getTime() + 3_600_000), resolutionNotes: "Synthetic corrective inspection recorded and independently reviewed." } });

      // Two open HIGH exceptions on driver 9 (Refilwe Sithole) — drives their
      // SERIOUS_ATTENTION rating alongside their profile gaps.
      await tx.exception.create({
        data: { id: id("exception", "open-1"), tenantId: tenant.id, gateEventId: returnException.id, inspectionResultId: cargoResultFail1.id, exceptionTypeId: conditionType.id, description: "Synthetic cargo discrepancy requiring neutral human review (rehearsal 1).", severity: "HIGH", requiresSupervisorApproval: true, outcomeAction: "MANUAL_REVIEW", raisedByUserId: officer, raisedAt: now },
      });
      await tx.exception.create({
        data: { id: id("exception", "open-2"), tenantId: tenant.id, gateEventId: departureException.id, inspectionResultId: cargoResultFail2.id, exceptionTypeId: conditionType.id, description: "Synthetic cargo discrepancy requiring neutral human review (rehearsal 2).", severity: "HIGH", requiresSupervisorApproval: true, outcomeAction: "MANUAL_REVIEW", raisedByUserId: officer, raisedAt: now },
      });

      // Two failed inspection items on driver 7 (Sibusiso Zwane) — reuses the
      // normal departure/return pair's vehicle slot via a dedicated movement,
      // driving their REVIEW_REQUIRED rating.
      const movementInspection = await tx.movementAuthorisation.create({
        data: {
          id: id("movement", "inspection-review"), tenantId: tenant.id, siteId: northern.id, vehicleId: vehicleIds[1], driverId: driverIds[6],
          movementType: "DELIVERY", purpose: `${ENVIRONMENT_LABEL} SCENARIO: inspection review`, destination: "Synthetic Customer, Example Test District",
          expectedDepartureAt: new Date(now.getTime() - 2 * 3_600_000), expectedReturnAt: new Date(now.getTime() + 3 * 3_600_000), expectedDistanceKm: 40,
          approvedCargoSummary: "Synthetic sealed test cargo", senderName: "Demo Dispatch", recipientName: "Synthetic Recipient",
          referenceCode: "DEMOMOV003", requesterUserId: dispatch, approverUserId: manager, status: "COMPLETED", approvalComments: "Approved for demo rehearsal only.",
        },
      });
      const departureInspectionReview = await tx.gateEvent.create({
        data: {
          id: id("gate-event", "inspection-review-out"), tenantId: tenant.id, siteId: northern.id, gateId: northernExit.id, direction: "EXIT",
          vehicleId: vehicleIds[1], driverId: driverIds[6], movementAuthorisationId: movementInspection.id, securityOfficerUserId: officer, inspectionTemplateId: template.id,
          status: "COMPLETED", identityVerificationResult: "SYNTHETIC_MANUAL_VERIFIED", identityVerifiedAt: new Date(now.getTime() - 2 * 3_600_000),
          startedAt: new Date(now.getTime() - 2 * 3_600_000), completedAt: new Date(now.getTime() - 1.8 * 3_600_000),
          decision: "CLEARED", decisionByUserId: officer, decisionAt: new Date(now.getTime() - 1.8 * 3_600_000), decisionReason: "Departure checks complete.",
        },
      });
      await tx.gateEventInspectionItem.createMany({
        data: [
          { id: id("inspection-result", "inspection-review-condition"), tenantId: tenant.id, gateEventId: departureInspectionReview.id, inspectionItemId: conditionItem.id, outcome: "FAIL", comment: "Synthetic overdue inspection item (rehearsal).", recordedByUserId: officer, recordedAt: departureInspectionReview.completedAt! },
          { id: id("inspection-result", "inspection-review-cargo"), tenantId: tenant.id, gateEventId: departureInspectionReview.id, inspectionItemId: cargoItem.id, outcome: "FAIL", comment: "Synthetic overdue inspection item (rehearsal).", recordedByUserId: officer, recordedAt: departureInspectionReview.completedAt! },
        ],
      });

      // --- Reconciliation with a discrepancy (driver 5 / licence-expiring) ---
      const discrepancyType = await tx.exceptionType.create({ data: { id: id("exception-type", "discrepancy"), tenantId: tenant.id, code: "DEMO_RECON", label: "Synthetic reconciliation discrepancy", defaultSeverity: "MEDIUM", defaultOutcomeAction: "MANUAL_REVIEW", requiresSupervisorApproval: false, isSystem: true } });
      const movementDiscrepancy = await tx.movementAuthorisation.create({
        data: {
          id: id("movement", "discrepancy"), tenantId: tenant.id, siteId: central.id, vehicleId: vehicleIds[3], driverId: driverIds[4],
          movementType: "DELIVERY", purpose: `${ENVIRONMENT_LABEL} SCENARIO: odometer discrepancy`, destination: "Synthetic Customer, Example Test District",
          expectedDepartureAt: new Date(now.getTime() - 6 * 3_600_000), expectedReturnAt: new Date(now.getTime() - 1 * 3_600_000), expectedDistanceKm: 70,
          approvedCargoSummary: "Synthetic sealed test cargo", senderName: "Demo Dispatch", recipientName: "Synthetic Recipient",
          referenceCode: "DEMOMOV004", requesterUserId: dispatch, approverUserId: manager, status: "COMPLETED", approvalComments: "Approved for demo rehearsal only.",
        },
      });
      const departureDiscrepancy = await tx.gateEvent.create({
        data: {
          id: id("gate-event", "discrepancy-out"), tenantId: tenant.id, siteId: central.id, gateId: centralExit.id, direction: "EXIT",
          vehicleId: vehicleIds[3], driverId: driverIds[4], movementAuthorisationId: movementDiscrepancy.id, securityOfficerUserId: officer, inspectionTemplateId: template.id,
          status: "COMPLETED", identityVerificationResult: "SYNTHETIC_MANUAL_VERIFIED", identityVerifiedAt: new Date(now.getTime() - 6 * 3_600_000),
          startedAt: new Date(now.getTime() - 6 * 3_600_000), completedAt: new Date(now.getTime() - 5.8 * 3_600_000),
          decision: "CLEARED", decisionByUserId: officer, decisionAt: new Date(now.getTime() - 5.8 * 3_600_000), decisionReason: "Departure checks complete.",
        },
      });
      const returnDiscrepancy = await tx.gateEvent.create({
        data: {
          id: id("gate-event", "discrepancy-in"), tenantId: tenant.id, siteId: central.id, gateId: centralEntrance.id, direction: "ENTRY",
          vehicleId: vehicleIds[3], driverId: driverIds[4], movementAuthorisationId: movementDiscrepancy.id, securityOfficerUserId: officer, inspectionTemplateId: template.id,
          status: "COMPLETED", identityVerificationResult: "SYNTHETIC_MANUAL_VERIFIED", identityVerifiedAt: new Date(now.getTime() - 1 * 3_600_000),
          startedAt: new Date(now.getTime() - 1 * 3_600_000), completedAt: new Date(now.getTime() - 0.8 * 3_600_000),
          decision: "CLEARED", decisionByUserId: officer, decisionAt: new Date(now.getTime() - 0.8 * 3_600_000), decisionReason: "Return checks complete.",
        },
      });
      const reconciliation = await tx.reconciliation.create({
        data: { id: id("reconciliation", "odometer"), tenantId: tenant.id, movementAuthorisationId: movementDiscrepancy.id, departureGateEventId: departureDiscrepancy.id, returnGateEventId: returnDiscrepancy.id, departureOdometer: 15200, returnOdometer: 15480, kmTravelled: 280, departureFuelPercent: 80, returnFuelPercent: 65, fuelDeltaPercent: -15, status: "OPEN" },
      });
      const discrepancyException = await tx.exception.create({
        data: { id: id("exception", "discrepancy"), tenantId: tenant.id, gateEventId: returnDiscrepancy.id, exceptionTypeId: discrepancyType.id, description: "Synthetic odometer discrepancy requiring neutral human review.", severity: "MEDIUM", requiresSupervisorApproval: false, outcomeAction: "MANUAL_REVIEW", raisedByUserId: officer, raisedAt: now },
      });
      await tx.reconciliationDiscrepancy.create({
        data: { id: id("discrepancy", "odometer"), tenantId: tenant.id, reconciliationId: reconciliation.id, category: "ODOMETER", severity: "MEDIUM", description: "Synthetic comparison difference; this is not proof of wrongdoing.", departureValue: "15200", returnValue: "15480", deltaValue: 280, linkedExceptionId: discrepancyException.id },
      });

      // --- Manual facial-verification fallback: one pending, one approved ---
      // (task requires: one awaiting approval, and one already approved by a
      // separate authorised officer — matching the segregation-of-duties
      // rule this app enforces structurally, not just at runtime).
      await tx.manualFacialVerificationFallback.create({
        data: { id: id("manual-fallback", "pending"), tenantId: tenant.id, driverId: driverIds[1], reason: "Synthetic camera unavailable at gate; identity confirmed against driver record.", requestedByUserId: officer, status: "PENDING", relatedGateEventId: departureNormal.id, requestedAt: now },
      });
      await tx.manualFacialVerificationFallback.create({
        data: { id: id("manual-fallback", "approved"), tenantId: tenant.id, driverId: driverIds[2], reason: "Synthetic document and existing driver record inspected; independent approval required.", requestedByUserId: officer, approvedByUserId: manager, status: "APPROVED", relatedGateEventId: returnNormal.id, requestedAt: now, resolvedAt: new Date(now.getTime() + 60_000) },
      });

      // --- Synthetic non-biometric facial template + attempt (labelled) -----
      const syntheticSentinel = Buffer.from("NOT-A-BIOMETRIC-TEMPLATE", "utf8");
      const syntheticIv = Buffer.from("SYNTHETIC-IV", "utf8");
      const syntheticTag = Buffer.from("SYNTHETIC-AUTH-TAG", "utf8");
      const template1 = await tx.driverFacialTemplate.create({
        data: {
          id: id("facial-template", 1), tenantId: tenant.id, driverId: driverIds[0], templateCiphertext: syntheticSentinel, templateIv: syntheticIv, templateAuthTag: syntheticTag,
          encryptionKeyId: "synthetic-sentinel-no-key", templateVersion: "synthetic-non-biometric-sentinel-v1", modelVersion: "no-model-simulator-v1", version: 1,
          providerId: "genbridge-local-biometric-simulator", synthetic: true, syntheticDisclosure: SYNTHETIC_BIOMETRIC_LABEL,
          consentAcknowledgedAt: now, lawfulAuthority: "CONSENT", noticeVersion: "live-demo-2026-08-v1", retentionPolicyVersion: "live-demo-2026-08-v1",
          enrolledByUserId: admin, enrolledAt: now,
        },
      });
      await tx.driver.update({ where: { id: driverIds[0] }, data: { facialVerificationEnrolled: true, facialVerificationProvider: "genbridge-local-biometric-simulator", facialVerificationEnrolledAt: now } });
      await tx.facialVerificationAttempt.create({
        data: {
          id: id("facial-attempt", "success"), tenantId: tenant.id, gateEventId: departureNormal.id, driverId: driverIds[0], templateId: template1.id,
          result: "MATCH", idempotencyKey: "live-demo:biometric:success", requestReceivedAt: now, confidenceScore: 0.92, threshold: 0.55,
          templateVersion: template1.templateVersion, modelVersion: "no-model-simulator-v1", providerId: "genbridge-local-biometric-simulator", providerVersion: "live-demo-v1",
          policyVersion: "synthetic-policy-v1", synthetic: true, syntheticDisclosure: SYNTHETIC_BIOMETRIC_LABEL, livenessResult: "PASSED", source: "ON_DEVICE",
          gateId: centralExit.id, deviceLabel: "synthetic-no-camera", securityOfficerUserId: officer, attemptedAt: now,
        },
      });

      // --- Onboarding progress (15 declared / 12 loaded / 3 remaining) ------
      // completedAt is set even though only 12/15 vehicles are loaded: the
      // app treats an unset completedAt as "onboarding required" and
      // redirects every login on the tenant to the setup wizard regardless
      // of role — found by direct browser verification against the live
      // deploy (WORKLOG.md 2026-08-25). The 15/12/3 story is still fully
      // visible on the onboarding/fleet-composition page on demand; it just
      // no longer gates every login.
      await tx.tenantOnboarding.create({
        data: {
          id: id("onboarding", 1), tenantId: tenant.id, currentStep: 6, completedSections: ["company", "fleet", "sites", "vehicles", "drivers", "staff"],
          declaredFleetSize: 15, fleetComposition: { TRUCK: 5, BAKKIE_PICKUP: 2, VAN: 1, PASSENGER: 1, SALES_REPRESENTATIVE: 2, TRAILER: 1 },
          completedAt: now,
        },
      });

      await tx.auditLog.create({ data: { id: id("audit", "seed"), tenantId: tenant.id, userId: admin, timestamp: now, action: "LIVE_DEMO_SYNTHETIC_DATA_PROVISIONED", entityType: "Tenant", entityId: tenant.id, reason: "Live synthetic customer-demonstration fixture; no external effects.", afterValue: { synthetic: true, environmentLabel: ENVIRONMENT_LABEL, version: 1 } } });

      void fleetManager;
      void pendingGuard;
      void vehicleIdByKey;
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  return { created: true, password };
}

function writeCredentialFile(password: string, appUrl: string): string {
  const dir = path.resolve(process.cwd(), ".data", "private");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "demo-login-details.txt");
  const today = new Date().toISOString().slice(0, 10);
  const deletionDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const roles = [
    ["Company Administrator", "demo.admin"],
    ["Dispatch and Logistics Officer", "demo.dispatch"],
    ["Gate Security Officer", "demo.guard"],
    ["Security Supervisor / Approving Manager", "demo.manager"],
    ["Fleet and GPS Manager", "demo.fleet"],
    ["Executive Read-Only Viewer", "demo.executive"],
  ] as const;
  const lines = [
    "Genbridge Fleet Governance — SYNTHETIC CUSTOMER DEMONSTRATION login details",
    `Generated: ${today}`,
    `Recommended deletion/rotation date: ${deletionDate} (run the cleanup command after the demo)`,
    "",
    `Live application URL: ${appUrl}`,
    "Tenant slug: genbridge-demo-logistics",
    "",
    "All accounts share the temporary password below.",
    `Password: ${password}`,
    "",
    "Accounts:",
    ...roles.map(([role, local]) => `  ${role.padEnd(45)} ${local}@genbridge.co.za`),
    "  Gate Security Officer (pending approval)      demo.guard.pending@genbridge.co.za",
    "",
    "Do not share this file or commit it to Git. It is covered by .gitignore.",
  ];
  fs.writeFileSync(filePath, lines.join("\n") + "\n", { mode: 0o600 });
  return filePath;
}

async function cmdCreate(): Promise<void> {
  assertLiveDemoCreateConfirmed();
  const prisma = createClient();
  try {
    const result = await provisionDemoTenant(prisma);
    if (result.created && result.password) {
      const appUrl = process.env.LIVE_DEMO_APP_URL || "https://genbridge-fleet-governance.onrender.com";
      const filePath = writeCredentialFile(result.password, appUrl);
      console.log(`[provision-live-demo] Created tenant ${LIVE_DEMO_TENANT_ID}.`);
      console.log(`[provision-live-demo] Login details written to: ${filePath}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

async function cmdVerify(): Promise<void> {
  const prisma = createClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: LIVE_DEMO_TENANT_SLUG }, select: { id: true, slug: true, name: true } });
    if (!tenant) {
      console.log("[provision-live-demo] Demo tenant does not exist.");
      return;
    }
    assertLiveDemoTenantIdentity(tenant);
    const [sites, gates, users, drivers, vehicles, assignments, documents, movements, gateEvents, exceptions, resolvedExceptions, reconciliations, manualFallbacks, approvedGuards, pendingGuards] = await Promise.all([
      prisma.site.count({ where: { tenantId: tenant.id } }),
      prisma.gate.count({ where: { tenantId: tenant.id } }),
      prisma.user.count({ where: { tenantId: tenant.id } }),
      prisma.driver.count({ where: { tenantId: tenant.id } }),
      prisma.vehicle.count({ where: { tenantId: tenant.id } }),
      prisma.driverVehicleAssignment.count({ where: { tenantId: tenant.id, status: "ACTIVE" } }),
      prisma.complianceDocument.count({ where: { tenantId: tenant.id } }),
      prisma.movementAuthorisation.count({ where: { tenantId: tenant.id } }),
      prisma.gateEvent.count({ where: { tenantId: tenant.id } }),
      prisma.exception.count({ where: { tenantId: tenant.id, resolvedAt: null } }),
      prisma.exception.count({ where: { tenantId: tenant.id, resolvedAt: { not: null } } }),
      prisma.reconciliation.count({ where: { tenantId: tenant.id } }),
      prisma.manualFacialVerificationFallback.count({ where: { tenantId: tenant.id } }),
      prisma.user.count({ where: { tenantId: tenant.id, role: { name: "Gate Security Officer" }, approvalStatus: "APPROVED" } }),
      prisma.user.count({ where: { tenantId: tenant.id, role: { name: "Gate Security Officer" }, approvalStatus: "PENDING" } }),
    ]);
    console.log(JSON.stringify({ tenant, counts: { sites, gates, users, drivers, vehicles, activeAssignments: assignments, documents, movements, gateEvents, openExceptions: exceptions, resolvedExceptions, reconciliations, manualFallbacks, approvedGuards, pendingGuards } }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

async function cmdCleanup(): Promise<void> {
  assertLiveDemoCleanupConfirmed();
  const prisma = createClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: LIVE_DEMO_TENANT_SLUG }, select: { id: true, slug: true, name: true } });
    if (!tenant) {
      console.log("[provision-live-demo] Demo tenant does not exist; nothing to clean up.");
      return;
    }
    assertLiveDemoTenantIdentity(tenant);
    console.log(`[provision-live-demo] Deleting demo tenant ${tenant.id} (${tenant.slug}) and everything under it...`);
    // Prisma's onDelete: Cascade on every tenant-scoped relation (see
    // schema.prisma Tenant model) means deleting the tenant row alone
    // removes every child record created above. Global rows (Permission
    // catalogue) are untouched — they are not tenant-scoped. AuditLog carries
    // a DB-level append-only trigger (DELETE raises P0001) even for a
    // synthetic demo tenant's own rows, so — same technique as
    // resetPilotTenant in src/lib/pilot/pilot-dataset.ts — the audit rows for
    // this one tenant are deleted first with triggers momentarily suspended,
    // then normal cascade delete removes everything else.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.auditLog.deleteMany({ where: { tenantId: LIVE_DEMO_TENANT_ID } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
      await tx.tenant.delete({ where: { id: LIVE_DEMO_TENANT_ID } });
    });
    console.log("[provision-live-demo] Demo tenant deleted.");
  } finally {
    await prisma.$disconnect();
  }
}

const command = process.argv[2];
const commands: Record<string, () => Promise<void>> = { create: cmdCreate, verify: cmdVerify, cleanup: cmdCleanup };
const run = commands[command];
if (!run) {
  console.error(`Usage: npx tsx scripts/provision-live-demo.ts <create|verify|cleanup>`);
  process.exit(1);
}
run().catch((error) => {
  console.error("[provision-live-demo] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
