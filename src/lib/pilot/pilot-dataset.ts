import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import {
  PILOT_EMAIL_DOMAIN,
  PILOT_EXPECTED_COUNTS,
  PILOT_TENANT_ID,
  PILOT_TENANT_NAME,
  PILOT_TENANT_SLUG,
  assertNonDeliverablePilotEmail,
  assertPilotDatabaseSafety,
  assertPilotTenantIdentity,
} from "./pilot-safety";

const PILOT_PASSWORD = "SyntheticPilot!Local1";
const FIXED_NOW = new Date("2026-08-01T08:00:00.000Z");
const STORAGE_LOCAL_PATH = process.env.STORAGE_LOCAL_PATH || "./.data/media";

const PILOT_ROLES = [
  ["Company Administrator", "administrator"],
  ["Dispatch and Logistics Officer", "dispatch"],
  ["Gate Security Officer", "security.officer"],
  ["Security Supervisor / Approving Manager", "approving.manager"],
  ["Accountant / Finance and Compliance Officer", "finance.reviewer"],
  ["Fleet and GPS Manager", "fleet.manager"],
  ["Internal Investigator / Auditor", "investigator"],
  ["External Reviewer", "internal.reviewer"],
  ["Executive Read-Only Viewer", "executive.viewer"],
  ["External Auditor (Case-Scoped)", "external.auditor"],
] as const;

function id(kind: string, suffix: string | number): string {
  return `pilot-${kind}-${suffix}`;
}

function pilotEmail(localPart: string): string {
  const email = `${localPart}@${PILOT_EMAIL_DOMAIN}`;
  assertNonDeliverablePilotEmail(email);
  return email;
}

export function createPilotClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for pilot operations.");
  assertPilotDatabaseSafety(databaseUrl);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

async function deletePilotFiles(storageKeys: string[]): Promise<void> {
  const root = path.resolve(process.cwd(), STORAGE_LOCAL_PATH);
  for (const storageKey of storageKeys) {
    if (!storageKey.startsWith(`${PILOT_TENANT_ID}/`)) throw new Error("Refusing to delete a non-pilot storage key.");
    const target = path.resolve(root, storageKey);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Refusing pilot file cleanup outside local storage root.");
    await fs.unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await fs.unlink(`${target}.meta.json`).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function resetPilotTenant(prisma: PrismaClient): Promise<boolean> {
  const existing = await prisma.tenant.findUnique({ where: { slug: PILOT_TENANT_SLUG }, select: { id: true, slug: true, name: true } });
  if (!existing) return false;
  assertPilotTenantIdentity(existing);
  const media = await prisma.mediaAsset.findMany({ where: { tenantId: existing.id }, select: { storageKey: true } });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.auditLog.deleteMany({ where: { tenantId: PILOT_TENANT_ID } });
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
    await tx.tenant.delete({ where: { id: PILOT_TENANT_ID } });
  });
  await deletePilotFiles(media.map((entry) => entry.storageKey));
  return true;
}

async function createSyntheticMedia(prisma: PrismaClient, ownerType: "GATE_EVENT_INSPECTION_ITEM" | "INVESTIGATION_CASE", ownerId: string, userId: string, suffix: string, investigationHold = false) {
  const contents = Buffer.from(`SYNTHETIC PILOT EVIDENCE ONLY\nFixture: ${suffix}\nNo real customer, person, vehicle or biometric data.\n`, "utf8");
  const storageKey = `${PILOT_TENANT_ID}/synthetic-${suffix}.txt`;
  const root = path.resolve(process.cwd(), STORAGE_LOCAL_PATH);
  const target = path.resolve(root, storageKey);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Invalid pilot storage path.");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
  await fs.writeFile(`${target}.meta.json`, JSON.stringify({ contentType: "text/plain" }));
  return prisma.mediaAsset.create({
    data: {
      id: id("media", suffix), tenantId: PILOT_TENANT_ID, ownerType, ownerId, capturedByUserId: userId,
      capturedAt: FIXED_NOW, fileName: `synthetic-${suffix}.txt`, contentType: "text/plain", fileSizeBytes: contents.byteLength,
      storageKey, checksumSha256: crypto.createHash("sha256").update(contents).digest("hex"), idempotencyKey: `pilot:${suffix}`,
      category: ownerType === "INVESTIGATION_CASE" ? "INVESTIGATION_EVIDENCE" : "DAMAGE_EVIDENCE",
      captureMetadata: { synthetic: true, source: "phase-14a-pilot-generator" }, investigationHold,
    },
  });
}

export async function seedPilotTenant(prisma: PrismaClient): Promise<void> {
  await resetPilotTenant(prisma);
  const templateTenant = await prisma.tenant.findUnique({ where: { slug: "acme-logistics" }, select: { id: true } });
  if (!templateTenant) throw new Error("Run npm run seed first; the local role template tenant is missing.");
  const templateRoles = await prisma.role.findMany({
    where: { tenantId: templateTenant.id, name: { in: PILOT_ROLES.map(([role]) => role) } },
    include: { rolePermissions: { select: { permissionId: true } } },
  });
  if (templateRoles.length !== PILOT_ROLES.length) throw new Error("The local role template is incomplete; refusing to broaden pilot permissions.");

  await prisma.tenant.create({ data: { id: PILOT_TENANT_ID, slug: PILOT_TENANT_SLUG, name: PILOT_TENANT_NAME, timezone: "Africa/Johannesburg", subscriptionStatus: "PAST_DUE" } });
  for (const template of templateRoles) {
    const role = await prisma.role.create({ data: { id: id("role", template.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")), tenantId: PILOT_TENANT_ID, name: template.name, description: `${template.description ?? ""} Synthetic pilot role copied without permission expansion.`, isSystem: true } });
    await prisma.rolePermission.createMany({ data: template.rolePermissions.map(({ permissionId }) => ({ roleId: role.id, permissionId })) });
  }

  const roles = new Map((await prisma.role.findMany({ where: { tenantId: PILOT_TENANT_ID } })).map((role) => [role.name, role.id]));
  const passwordHash = await bcrypt.hash(PILOT_PASSWORD, 12);
  for (const [roleName, localPart] of PILOT_ROLES) {
    await prisma.user.create({ data: { id: id("user", localPart), tenantId: PILOT_TENANT_ID, roleId: roles.get(roleName)!, email: pilotEmail(localPart), name: `Synthetic ${roleName}`, status: "ACTIVE", passwordHash } });
  }
  const users = new Map((await prisma.user.findMany({ where: { tenantId: PILOT_TENANT_ID } })).map((user) => [user.roleId, user]));
  const userFor = (roleName: string) => users.get(roles.get(roleName)!)!;
  const admin = userFor("Company Administrator");
  const dispatch = userFor("Dispatch and Logistics Officer");
  const officer = userFor("Gate Security Officer");
  const manager = userFor("Security Supervisor / Approving Manager");
  const investigator = userFor("Internal Investigator / Auditor");
  const auditor = userFor("External Auditor (Case-Scoped)");

  const north = await prisma.site.create({ data: { id: id("site", "north"), tenantId: PILOT_TENANT_ID, name: "Synthetic North Logistics Hub", address: "1 Example Test Avenue, Fictional Park" } });
  const service = await prisma.site.create({ data: { id: id("site", "service"), tenantId: PILOT_TENANT_ID, name: "Synthetic Service and Returns Yard", address: "2 Example Test Avenue, Fictional Park" } });
  const gates = await Promise.all([
    prisma.gate.create({ data: { id: id("gate", "north-main"), tenantId: PILOT_TENANT_ID, siteId: north.id, name: "Synthetic North Main Gate", direction: "BOTH" } }),
    prisma.gate.create({ data: { id: id("gate", "north-heavy"), tenantId: PILOT_TENANT_ID, siteId: north.id, name: "Synthetic Heavy Vehicle Gate", direction: "BOTH" } }),
    prisma.gate.create({ data: { id: id("gate", "service-entry"), tenantId: PILOT_TENANT_ID, siteId: service.id, name: "Synthetic Service Entry", direction: "ENTRY" } }),
    prisma.gate.create({ data: { id: id("gate", "service-exit"), tenantId: PILOT_TENANT_ID, siteId: service.id, name: "Synthetic Service Exit", direction: "EXIT" } }),
  ]);

  const drivers = [];
  for (let index = 1; index <= 15; index += 1) {
    drivers.push(await prisma.driver.create({ data: {
      id: id("driver", index), tenantId: PILOT_TENANT_ID, employeeNumber: `SYN-D${String(index).padStart(3, "0")}`,
      name: `Synthetic Driver ${String(index).padStart(2, "0")}`, contactEmail: pilotEmail(`driver.${String(index).padStart(2, "0")}`),
      department: index <= 8 ? "Synthetic Distribution" : "Synthetic Service Operations", licenceNumber: `SYN-LIC-${String(index).padStart(4, "0")}`,
      licenceClass: index <= 10 ? "C1" : "EC", licenceExpiry: new Date("2028-12-31T00:00:00.000Z"), pdpNumber: `SYN-PDP-${String(index).padStart(4, "0")}`,
      pdpExpiry: new Date("2028-06-30T00:00:00.000Z"), authorisedVehicleClasses: [index <= 10 ? "LIGHT_COMMERCIAL" : "TRUCK"],
      restrictions: "SYNTHETIC PILOT RECORD — not a real person", facialVerificationEnrolled: false,
    } }));
  }

  const vehicles = [];
  for (let index = 1; index <= 15; index += 1) {
    const trailer = index >= 14;
    vehicles.push(await prisma.vehicle.create({ data: {
      id: id("vehicle", index), tenantId: PILOT_TENANT_ID, fleetNumber: `SYN-FLT-${String(index).padStart(3, "0")}`,
      registrationNumber: `SYN${String(index).padStart(3, "0")}GP`, vin: `SYNTHETICVIN${String(index).padStart(5, "0")}`,
      make: "Synthetic Motors", model: trailer ? "Test Trailer" : index > 10 ? "Test Truck" : "Test Van", year: 2025,
      colour: "White", category: trailer ? "TRAILER" : index > 10 ? "TRUCK" : "LIGHT_COMMERCIAL", ownership: "OWNED", fuelType: trailer ? null : "DIESEL",
      tankCapacityLitres: trailer ? null : 80, odometerReading: trailer ? null : 10000 + index * 100,
      fuelLevelPercent: trailer ? null : 75, assignedDriverId: trailer ? null : drivers[index - 1].id,
      licenceDiscExpiry: new Date("2028-12-31T00:00:00.000Z"), roadworthyExpiry: new Date("2028-06-30T00:00:00.000Z"), insuranceExpiry: new Date("2028-09-30T00:00:00.000Z"),
      gpsProvider: trailer ? null : "synthetic", gpsDeviceReference: trailer ? null : `SYN-TRACK-${index}`, gpsStatus: index === 7 ? "INACTIVE" : trailer ? "UNKNOWN" : "ACTIVE",
      gpsLastCommunicationAt: index === 7 ? new Date("2026-07-20T08:00:00.000Z") : trailer ? null : FIXED_NOW,
      baselineConditionNotes: "SYNTHETIC PILOT VEHICLE — no real asset", operationalStatus: index === 3 ? "WORKSHOP_LOCKOUT" : "OPERATIONAL",
    } }));
  }

  for (const driver of drivers) {
    await prisma.complianceDocument.create({ data: { id: id("document", `driver-${driver.id}`), tenantId: PILOT_TENANT_ID, ownerType: "DRIVER", driverId: driver.id, documentType: "DRIVER_LICENCE", documentNumber: `SYN-${driver.employeeNumber}`, issuer: "Synthetic Licensing Authority", expiryDate: new Date("2028-12-31T00:00:00.000Z"), verificationStatus: "VERIFIED", verifiedById: admin.id, verifiedAt: FIXED_NOW, notes: "Synthetic UAT document; no real attachment." } });
  }
  for (const vehicle of vehicles) {
    await prisma.complianceDocument.create({ data: { id: id("document", `vehicle-${vehicle.id}`), tenantId: PILOT_TENANT_ID, ownerType: "VEHICLE", vehicleId: vehicle.id, documentType: "VEHICLE_LICENCE", documentNumber: `SYN-${vehicle.registrationNumber}`, issuer: "Synthetic Licensing Authority", expiryDate: new Date("2028-12-31T00:00:00.000Z"), verificationStatus: "VERIFIED", verifiedById: admin.id, verifiedAt: FIXED_NOW, notes: "Synthetic UAT document; no real attachment." } });
  }

  const template = await prisma.inspectionTemplate.create({ data: { id: id("inspection", "template"), tenantId: PILOT_TENANT_ID, name: "Synthetic Pilot Gate Inspection", description: "Synthetic Phase 14A checklist", isSystem: true } });
  const inspectionItems = await Promise.all([
    prisma.inspectionItem.create({ data: { id: id("inspection", "condition"), templateId: template.id, section: "EXTERIOR_CONDITION", label: "Synthetic exterior condition", sortOrder: 1, defaultExceptionSeverity: "HIGH", requiresSupervisorApprovalOnFail: true } }),
    prisma.inspectionItem.create({ data: { id: id("inspection", "odometer"), templateId: template.id, section: "OPERATIONAL_INFO", label: "Synthetic odometer", sortOrder: 2, responseType: "READING", unit: "km" } }),
    prisma.inspectionItem.create({ data: { id: id("inspection", "cargo"), templateId: template.id, section: "LOAD_VERIFICATION", label: "Synthetic cargo and equipment", sortOrder: 3, defaultExceptionSeverity: "HIGH", requiresSupervisorApprovalOnFail: true } }),
  ]);
  const conditionType = await prisma.exceptionType.create({ data: { id: id("exception-type", "condition"), tenantId: PILOT_TENANT_ID, code: "SYN_CONDITION", label: "Synthetic vehicle-condition failure", defaultSeverity: "HIGH", defaultOutcomeAction: "WORKSHOP_LOCKOUT", requiresSupervisorApproval: true, isSystem: true } });
  const discrepancyType = await prisma.exceptionType.create({ data: { id: id("exception-type", "discrepancy"), tenantId: PILOT_TENANT_ID, code: "SYN_RECON", label: "Synthetic reconciliation discrepancy", defaultSeverity: "HIGH", defaultOutcomeAction: "MANUAL_REVIEW", requiresSupervisorApproval: true, isSystem: true } });

  const scenarioNames = ["normal-return", "late-return", "condition-failure", "cargo-discrepancy", "fuel-discrepancy", "odometer-discrepancy", "tracker-unavailable", "gate-override", "unauthorised-attempt"];
  const movements = [];
  for (let index = 0; index < scenarioNames.length; index += 1) {
    const scenario = scenarioNames[index];
    const completed = index < 6 || scenario === "gate-override";
    movements.push(await prisma.movementAuthorisation.create({ data: {
      id: id("movement", scenario), tenantId: PILOT_TENANT_ID, siteId: north.id, vehicleId: vehicles[index].id, driverId: drivers[index].id,
      movementType: index % 2 === 0 ? "DELIVERY" : "COLLECTION", purpose: `SYNTHETIC PILOT SCENARIO: ${scenario}`,
      destination: "Synthetic Customer, Example Test District", expectedDepartureAt: new Date(FIXED_NOW.getTime() - 4 * 3_600_000), expectedReturnAt: new Date(FIXED_NOW.getTime() + 4 * 3_600_000),
      expectedDistanceKm: 80, approvedCargoSummary: "Synthetic sealed test cargo", senderName: "Synthetic Dispatch", recipientName: "Synthetic Recipient",
      referenceCode: `SYNPILOT${String(index + 1).padStart(3, "0")}`, requesterUserId: dispatch.id,
      approverUserId: scenario === "unauthorised-attempt" ? null : manager.id, status: scenario === "unauthorised-attempt" ? "SUBMITTED" : scenario === "condition-failure" ? "IN_PROGRESS" : completed ? "COMPLETED" : "APPROVED",
      approvalComments: scenario === "unauthorised-attempt" ? null : "Approved for synthetic UAT only.",
    } }));
  }

  const eventPairs = new Map<string, { departureId: string; returnId: string }>();
  for (let index = 0; index < 6; index += 1) {
    const movement = movements[index];
    const scenario = scenarioNames[index];
    const departure = await prisma.gateEvent.create({ data: { id: id("gate-event", `${scenario}-out`), tenantId: PILOT_TENANT_ID, siteId: north.id, gateId: gates[0].id, direction: "EXIT", vehicleId: movement.vehicleId, driverId: movement.driverId, movementAuthorisationId: movement.id, securityOfficerUserId: officer.id, inspectionTemplateId: template.id, status: "COMPLETED", identityVerificationResult: "SYNTHETIC_MANUAL_VERIFIED", identityVerifiedAt: new Date(FIXED_NOW.getTime() - 3 * 3_600_000), startedAt: new Date(FIXED_NOW.getTime() - 3 * 3_600_000), completedAt: new Date(FIXED_NOW.getTime() - 2.8 * 3_600_000), decision: "CLEARED", decisionByUserId: officer.id, decisionAt: new Date(FIXED_NOW.getTime() - 2.8 * 3_600_000), decisionReason: "Synthetic pilot departure checks complete." } });
    const returnOffsetHours = scenario === "late-return" ? 6 : 3;
    const returnEvent = await prisma.gateEvent.create({ data: { id: id("gate-event", `${scenario}-in`), tenantId: PILOT_TENANT_ID, siteId: north.id, gateId: gates[0].id, direction: "ENTRY", vehicleId: movement.vehicleId, driverId: movement.driverId, movementAuthorisationId: movement.id, securityOfficerUserId: officer.id, inspectionTemplateId: template.id, status: scenario === "condition-failure" ? "DENIED" : "COMPLETED", identityVerificationResult: "SYNTHETIC_MANUAL_VERIFIED", identityVerifiedAt: new Date(FIXED_NOW.getTime() + returnOffsetHours * 3_600_000), startedAt: new Date(FIXED_NOW.getTime() + returnOffsetHours * 3_600_000), completedAt: new Date(FIXED_NOW.getTime() + (returnOffsetHours + 0.2) * 3_600_000), decision: scenario === "condition-failure" ? "DENIED" : "CLEARED", decisionByUserId: scenario === "condition-failure" ? manager.id : officer.id, decisionAt: new Date(FIXED_NOW.getTime() + (returnOffsetHours + 0.2) * 3_600_000), decisionReason: scenario === "condition-failure" ? "Synthetic safety defect requires corrective action." : "Synthetic return checks complete." } });
    eventPairs.set(scenario, { departureId: departure.id, returnId: returnEvent.id });
    await prisma.gateEventInspectionItem.createMany({ data: [
      { id: id("inspection-result", `${scenario}-out-condition`), tenantId: PILOT_TENANT_ID, gateEventId: departure.id, inspectionItemId: inspectionItems[0].id, outcome: "PASS", recordedByUserId: officer.id, recordedAt: departure.completedAt! },
      { id: id("inspection-result", `${scenario}-in-condition`), tenantId: PILOT_TENANT_ID, gateEventId: returnEvent.id, inspectionItemId: inspectionItems[0].id, outcome: scenario === "condition-failure" ? "FAIL" : "PASS", comment: scenario === "condition-failure" ? "Synthetic tyre-sidewall defect observed." : null, exceptionSeverity: scenario === "condition-failure" ? "HIGH" : null, supervisorApprovalRequired: scenario === "condition-failure", recordedByUserId: officer.id, recordedAt: returnEvent.completedAt! },
    ] });
  }

  const overrideMovement = movements[scenarioNames.indexOf("gate-override")];
  for (const [suffix, direction, offset] of [["out", "EXIT", -2], ["in", "ENTRY", 2]] as const) {
    const overrideEvent = await prisma.gateEvent.create({ data: { id: id("gate-event", `gate-override-${suffix}`), tenantId: PILOT_TENANT_ID, siteId: north.id, gateId: gates[0].id, direction, vehicleId: overrideMovement.vehicleId, driverId: overrideMovement.driverId, movementAuthorisationId: overrideMovement.id, securityOfficerUserId: officer.id, inspectionTemplateId: template.id, status: "COMPLETED", identityVerificationResult: "SYNTHETIC_MANUAL_VERIFIED", identityVerifiedAt: new Date(FIXED_NOW.getTime() + offset * 3_600_000), startedAt: new Date(FIXED_NOW.getTime() + offset * 3_600_000), completedAt: new Date(FIXED_NOW.getTime() + (offset + 0.2) * 3_600_000), decision: "CLEARED", decisionByUserId: manager.id, decisionAt: new Date(FIXED_NOW.getTime() + (offset + 0.2) * 3_600_000), decisionReason: "Synthetic authorised override with compulsory reason and independent manager attribution." } });
    await prisma.gateEventInspectionItem.create({ data: { id: id("inspection-result", `gate-override-${suffix}-condition`), tenantId: PILOT_TENANT_ID, gateEventId: overrideEvent.id, inspectionItemId: inspectionItems[0].id, outcome: "UNABLE_TO_VERIFY", comment: "Synthetic override retained for human review.", exceptionSeverity: "MEDIUM", supervisorApprovalRequired: true, recordedByUserId: officer.id, recordedAt: overrideEvent.completedAt! } });
  }

  const conditionResultId = id("inspection-result", "condition-failure-in-condition");
  const conditionException = await prisma.exception.create({ data: { id: id("exception", "condition"), tenantId: PILOT_TENANT_ID, gateEventId: eventPairs.get("condition-failure")!.returnId, inspectionResultId: conditionResultId, exceptionTypeId: conditionType.id, description: "Synthetic safety defect; vehicle held for authorised correction.", severity: "HIGH", requiresSupervisorApproval: true, outcomeAction: "WORKSHOP_LOCKOUT", raisedByUserId: officer.id, raisedAt: FIXED_NOW } });
  const conditionMedia = await createSyntheticMedia(prisma, "GATE_EVENT_INSPECTION_ITEM", conditionResultId, officer.id, "condition-defect");
  await prisma.gateEventInspectionItem.update({ where: { id: conditionResultId }, data: { evidenceMediaAssetId: conditionMedia.id } });

  for (const [scenario, category, departureOdometer, returnOdometer, departureFuel, returnFuel] of [
    ["normal-return", null, 10100, 10180, 80, 72], ["late-return", null, 10200, 10280, 75, 68],
    ["cargo-discrepancy", "CARGO_AND_LOAD", 10400, 10480, 78, 70], ["fuel-discrepancy", "FUEL", 10500, 10580, 90, 50],
    ["odometer-discrepancy", "ODOMETER", 10600, 10880, 82, 74],
  ] as const) {
    const movement = movements[scenarioNames.indexOf(scenario)];
    const pair = eventPairs.get(scenario)!;
    const reconciliation = await prisma.reconciliation.create({ data: { id: id("reconciliation", scenario), tenantId: PILOT_TENANT_ID, movementAuthorisationId: movement.id, departureGateEventId: pair.departureId, returnGateEventId: pair.returnId, departureOdometer, returnOdometer, kmTravelled: returnOdometer - departureOdometer, departureFuelPercent: departureFuel, returnFuelPercent: returnFuel, fuelDeltaPercent: returnFuel - departureFuel, status: category ? "OPEN" : "NO_DISCREPANCIES" } });
    if (category) {
      const linked = await prisma.exception.create({ data: { id: id("exception", scenario), tenantId: PILOT_TENANT_ID, gateEventId: pair.returnId, exceptionTypeId: discrepancyType.id, description: `Synthetic ${category.toLowerCase().replaceAll("_", " ")} discrepancy requiring neutral human review.`, severity: "HIGH", requiresSupervisorApproval: true, outcomeAction: "MANUAL_REVIEW", raisedByUserId: officer.id, raisedAt: FIXED_NOW } });
      await prisma.reconciliationDiscrepancy.create({ data: { id: id("discrepancy", scenario), tenantId: PILOT_TENANT_ID, reconciliationId: reconciliation.id, category, severity: "HIGH", description: "Synthetic comparison difference; this is not proof of wrongdoing.", departureValue: category === "FUEL" ? `${departureFuel}%` : `${departureOdometer}`, returnValue: category === "FUEL" ? `${returnFuel}%` : `${returnOdometer}`, deltaValue: category === "FUEL" ? returnFuel - departureFuel : returnOdometer - departureOdometer, linkedExceptionId: linked.id } });
    }
  }
  await prisma.telematicsEvent.createMany({ data: [
    { id: id("telematics", "mock-current"), tenantId: PILOT_TENANT_ID, vehicleId: vehicles[0].id, source: "PROVIDER", latitude: -26.2041, longitude: 28.0473, speedKmh: 0, ignitionOn: false, odometerKm: 10180, recordedAt: FIXED_NOW, providerReference: "SYNTHETIC-MOCK-CURRENT" },
    { id: id("telematics", "mock-mismatch"), tenantId: PILOT_TENANT_ID, vehicleId: vehicles[5].id, source: "PROVIDER", latitude: -26.2, longitude: 28.04, speedKmh: 0, ignitionOn: false, odometerKm: 10700, recordedAt: FIXED_NOW, providerReference: "SYNTHETIC-MOCK-MISMATCH" },
  ] });
  await prisma.manualGpsConfirmation.create({ data: { id: id("gps", "unavailable"), tenantId: PILOT_TENANT_ID, vehicleId: vehicles[6].id, reason: "Synthetic tracker unavailable; manual confirmation required.", positionDescription: "Synthetic dispatch yard — unverified by provider", requestedByUserId: dispatch.id, requestedAt: FIXED_NOW, status: "PENDING" } });

  await prisma.tenantInvestigationSettings.create({ data: { id: id("investigation", "settings"), tenantId: PILOT_TENANT_ID, casePrefix: "SYN" } });
  const closedCase = await prisma.investigationCase.create({ data: { id: id("case", "closed"), tenantId: PILOT_TENANT_ID, caseNumber: "SYN-2026-000001", title: "Synthetic cargo discrepancy review", description: "Synthetic allegation requiring fair, documented review; not a statement of fact.", source: "RECONCILIATION_DISCREPANCY", category: "DATA_INTEGRITY", priority: "HIGH", status: "CLOSED", outcome: "INCONCLUSIVE", confidentiality: "RESTRICTED", reportingPersonUserId: officer.id, assignedInvestigatorUserId: investigator.id, caseOwnerUserId: manager.id, createdByUserId: manager.id, submittedAt: new Date("2026-08-01T08:30:00.000Z"), triagedAt: new Date("2026-08-01T09:00:00.000Z"), closedAt: new Date("2026-08-02T12:00:00.000Z"), closedByUserId: manager.id, evidenceHoldActive: true } });
  const unrelatedCase = await prisma.investigationCase.create({ data: { id: id("case", "unrelated"), tenantId: PILOT_TENANT_ID, caseNumber: "SYN-2026-000002", title: "Synthetic unrelated restricted review", description: "Must remain invisible to case-scoped external auditors.", source: "MANUAL_CONCERN", category: "OTHER", priority: "MEDIUM", status: "TRIAGE", confidentiality: "HIGHLY_RESTRICTED", caseOwnerUserId: manager.id, createdByUserId: manager.id, submittedAt: FIXED_NOW, evidenceHoldActive: true } });
  await prisma.investigationSubject.create({ data: { id: id("subject", "witness"), tenantId: PILOT_TENANT_ID, caseId: closedCase.id, role: "WITNESS", contractorName: "Synthetic Witness", notes: "Fictional UAT party", explanationResponse: "Synthetic contemporaneous explanation retained separately from findings.", explanationRespondedAt: FIXED_NOW, createdByUserId: investigator.id } });
  await prisma.investigationNote.create({ data: { id: id("note", "restricted"), tenantId: PILOT_TENANT_ID, caseId: closedCase.id, authorUserId: investigator.id, confidentiality: "RESTRICTED", content: "Synthetic restricted note; excluded from external-auditor views." } });
  const finding = await prisma.investigationFinding.create({ data: { id: id("finding", "closed-v1"), tenantId: PILOT_TENANT_ID, caseId: closedCase.id, version: 1, executiveSummary: "Synthetic evidence was insufficient for a definitive conclusion.", detailedFindings: "Neutral synthetic review considered the discrepancy, response and evidence.", subjectResponseSummary: "Synthetic response was retained and considered.", outcome: "INCONCLUSIVE", recommendations: "Review synthetic cargo-control process.", status: "APPROVED", createdByUserId: investigator.id, createdAt: FIXED_NOW, submittedByUserId: investigator.id, submittedAt: new Date("2026-08-02T10:00:00.000Z") } });
  await prisma.investigationApproval.create({ data: { id: id("approval", "closed-v1"), tenantId: PILOT_TENANT_ID, caseId: closedCase.id, findingId: finding.id, action: "APPROVE", actorUserId: manager.id, reason: "Independent synthetic UAT approval.", createdAt: new Date("2026-08-02T11:00:00.000Z") } });
  const investigationMedia = await createSyntheticMedia(prisma, "INVESTIGATION_CASE", closedCase.id, investigator.id, "investigation-evidence", true);
  await prisma.investigationEvidenceLink.create({ data: { id: id("evidence-link", 1), tenantId: PILOT_TENANT_ID, caseId: closedCase.id, evidenceNumber: 1, mediaAssetId: investigationMedia.id, description: "Synthetic cargo comparison document", relevance: "Demonstrates evidence hold and case-scoped access.", confidentiality: "RESTRICTED", addedByUserId: investigator.id, addedAt: FIXED_NOW } });
  await prisma.investigationChronologyEvent.createMany({ data: [
    { id: id("chronology", 1), tenantId: PILOT_TENANT_ID, caseId: closedCase.id, eventType: "CASE_TRIAGED", description: "Synthetic case triaged.", actorUserId: manager.id, occurredAt: new Date("2026-08-01T09:00:00.000Z") },
    { id: id("chronology", 2), tenantId: PILOT_TENANT_ID, caseId: closedCase.id, eventType: "FINDING_APPROVED", description: "Synthetic finding independently approved.", actorUserId: manager.id, occurredAt: new Date("2026-08-02T11:00:00.000Z") },
    { id: id("chronology", 3), tenantId: PILOT_TENANT_ID, caseId: closedCase.id, eventType: "CASE_CLOSED", description: "Synthetic case closed; evidence hold remains active.", actorUserId: manager.id, occurredAt: new Date("2026-08-02T12:00:00.000Z") },
  ] });
  await prisma.externalAuditorAccessGrant.create({ data: { id: id("auditor-grant", 1), tenantId: PILOT_TENANT_ID, externalAuditorUserId: auditor.id, grantedByUserId: admin.id, reason: "Synthetic time-limited UAT access", canDownloadReport: true, canDownloadEvidence: true, startAt: new Date("2026-08-01T00:00:00.000Z"), expiresAt: new Date("2030-01-01T00:00:00.000Z"), cases: { create: { id: id("auditor-grant-case", 1), caseId: closedCase.id } } } });

  const analyticsRule = await prisma.analyticsRule.create({ data: { id: id("analytics-rule", 1), tenantId: PILOT_TENANT_ID, code: "SYNTHETIC_PILOT_REVIEW", label: "Synthetic pilot review signals", description: "Deterministic UAT-only rule; never an accusation.", evaluationPeriodDays: 30, minimumOccurrenceCount: 2, severity: "MEDIUM", operatingHourStart: "06:00", operatingHourEnd: "20:00", configuredByUserId: admin.id, configuredAt: FIXED_NOW } });
  const indicatorSpecs = [
    ["late", "Late return requires explanation", "MOCK", "REVIEWED", movements[1].id, null],
    ["override", "Repeated gate overrides require review", "MANUAL", "OPEN", gates[0].id, null],
    ["tracker", "Tracker data unavailable", "UNAVAILABLE", "OPEN", vehicles[6].id, null],
    ["cargo", "Cargo discrepancy escalated for investigation", "MIXED", "ESCALATED", vehicles[3].id, closedCase.id],
  ] as const;
  for (const [suffix, title, quality, status, subjectId, linkedCaseId] of indicatorSpecs) {
    const indicator = await prisma.analyticsIndicator.create({ data: { id: id("indicator", suffix), tenantId: PILOT_TENANT_ID, ruleId: analyticsRule.id, ruleCode: analyticsRule.code, ruleVersion: analyticsRule.version, ruleSnapshot: { synthetic: true, minimumOccurrenceCount: 2, humanReviewRequired: true }, evaluationStart: new Date("2026-07-01T00:00:00.000Z"), evaluationEnd: FIXED_NOW, subjectType: suffix === "late" ? "MOVEMENT" : suffix === "override" ? "GATE" : "VEHICLE", subjectId, subjectLabel: `Synthetic ${suffix} subject`, severity: suffix === "cargo" ? "HIGH" : "MEDIUM", title, explanation: "Synthetic deterministic records met the configured threshold. Missing or mock data is not proof of misconduct.", recommendedAction: "An authorised human should review source records and record context.", supportingRecords: [{ type: "SYNTHETIC_UAT", id: subjectId }], dataQuality: quality, firstDetectedAt: FIXED_NOW, lastDetectedAt: FIXED_NOW, occurrenceCount: 2, status, reviewedByUserId: status === "REVIEWED" ? manager.id : null, reviewedAt: status === "REVIEWED" ? FIXED_NOW : null, reviewNotes: status === "REVIEWED" ? "Synthetic late return explained during UAT." : null, linkedInvestigationCaseId: linkedCaseId, calculationKey: `pilot:${suffix}:2026-08-01` } });
    if (status !== "OPEN") await prisma.analyticsIndicatorEvent.create({ data: { id: id("indicator-event", suffix), tenantId: PILOT_TENANT_ID, indicatorId: indicator.id, action: status, fromStatus: "OPEN", toStatus: status, note: "Synthetic UAT chronology event.", actorUserId: manager.id, occurredAt: FIXED_NOW } });
  }
  await prisma.analyticsCalculationRun.create({ data: { id: id("analytics-run", 1), tenantId: PILOT_TENANT_ID, status: "SUCCEEDED", startedAt: FIXED_NOW, finishedAt: new Date(FIXED_NOW.getTime() + 1_000), rulesEvaluated: 1, indicatorsCreated: 4, dataQuality: "MIXED", resultSummary: { synthetic: true, externalProviderCalls: 0 } } });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { name: "Standard" } });
  if (!plan) throw new Error("Run npm run seed first; the synthetic subscription plan fixture is missing.");
  await prisma.tenantSubscription.create({ data: { id: id("subscription", 1), tenantId: PILOT_TENANT_ID, planId: plan.id, status: "PAST_DUE", startedAt: new Date("2026-07-01T00:00:00.000Z") } });
  await prisma.tenantBillingProfile.create({ data: { id: id("billing-profile", 1), tenantId: PILOT_TENANT_ID, registeredBusinessName: PILOT_TENANT_NAME, tradingName: "SYNTHETIC PILOT — NOT A CUSTOMER", billingAddressLine1: "1 Example Test Avenue", billingCity: "Fictional Park", billingPostalCode: "0000", billingEmail: pilotEmail("billing"), accountsContactName: "Synthetic Finance Contact", accountsContactEmail: pilotEmail("accounts"), notes: "Mock-only billing; no real payment may be initiated." } });
  await prisma.auditLog.create({ data: { id: id("audit", "seed"), tenantId: PILOT_TENANT_ID, userId: admin.id, timestamp: FIXED_NOW, action: "PILOT_SYNTHETIC_DATA_SEEDED", entityType: "Tenant", entityId: PILOT_TENANT_ID, reason: "Local Phase 14A UAT fixture; no external effects.", afterValue: { synthetic: true, version: 1 } } });
  void unrelatedCase;
  void conditionException;
}

export async function verifyPilotTenant(prisma: PrismaClient) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: PILOT_TENANT_SLUG }, select: { id: true, slug: true, name: true, status: true, subscriptionStatus: true } });
  if (!tenant) throw new Error("Synthetic pilot tenant is not seeded.");
  assertPilotTenantIdentity(tenant);
  const [sites, gates, users, drivers, vehicles, complianceDocuments, movements, gateEvents, reconciliations, exceptions, investigations, analyticsIndicators, telematicsEvents, manualGpsConfirmations, biometrics, deliverableEmails, heldEvidence, externalGrants] = await Promise.all([
    prisma.site.count({ where: { tenantId: tenant.id } }), prisma.gate.count({ where: { tenantId: tenant.id } }), prisma.user.count({ where: { tenantId: tenant.id } }),
    prisma.driver.count({ where: { tenantId: tenant.id } }), prisma.vehicle.count({ where: { tenantId: tenant.id } }), prisma.complianceDocument.count({ where: { tenantId: tenant.id } }),
    prisma.movementAuthorisation.count({ where: { tenantId: tenant.id } }), prisma.gateEvent.count({ where: { tenantId: tenant.id } }), prisma.reconciliation.count({ where: { tenantId: tenant.id } }), prisma.exception.count({ where: { tenantId: tenant.id } }),
    prisma.investigationCase.count({ where: { tenantId: tenant.id } }), prisma.analyticsIndicator.count({ where: { tenantId: tenant.id } }), prisma.telematicsEvent.count({ where: { tenantId: tenant.id } }), prisma.manualGpsConfirmation.count({ where: { tenantId: tenant.id } }),
    prisma.driverFacialTemplate.count({ where: { tenantId: tenant.id } }), prisma.user.count({ where: { tenantId: tenant.id, NOT: { email: { endsWith: `@${PILOT_EMAIL_DOMAIN}` } } } }),
    prisma.mediaAsset.count({ where: { tenantId: tenant.id, investigationHold: true } }), prisma.externalAuditorAccessGrant.count({ where: { tenantId: tenant.id, revokedAt: null } }),
  ]);
  const counts = { sites, gates, users, drivers, vehicles, complianceDocuments, movements, gateEvents, reconciliations, exceptions, investigations, analyticsIndicators, telematicsEvents, manualGpsConfirmations };
  for (const [key, expected] of Object.entries(PILOT_EXPECTED_COUNTS)) {
    if (counts[key as keyof typeof counts] !== expected) throw new Error(`Pilot verification failed: ${key} expected ${expected}.`);
  }
  if (biometrics !== 0 || deliverableEmails !== 0 || heldEvidence < 1 || externalGrants !== 1) throw new Error("Pilot privacy/access invariants failed.");
  return { tenant: { ...tenant, synthetic: true }, counts, invariants: { biometricTemplates: biometrics, nonDeliverableAddressesOnly: true, heldEvidence, caseScopedExternalGrants: externalGrants, providers: "mock/no-op/disabled" } };
}

export async function withPilotClient<T>(operation: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  const prisma = createPilotClient();
  try { return await operation(prisma); } finally { await prisma.$disconnect(); }
}
