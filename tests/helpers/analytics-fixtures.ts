import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { createGate, createSite, createTenant, createDriver, createVehicle } from "./fixtures";
import { makeSessionForTenant } from "./billing-session";
import type { Tenant } from "@/generated/prisma/client";

export const ANALYTICS_MANAGER_PERMISSIONS: Array<[string, string]> = [
  ["governanceAnalytics", "VIEW"],
  ["analyticsIndicator", "VIEW"],
  ["analyticsIndicator", "EDIT"],
  ["analyticsIndicator", "CREATE"],
  ["analyticsRule", "VIEW"],
  ["analyticsRule", "CONFIGURE"],
  ["analyticsExport", "EXPORT"],
  ["site", "VIEW"],
  ["gate", "VIEW"],
  ["vehicle", "VIEW"],
  ["driver", "VIEW"],
  ["movement", "VIEW"],
  ["gateEvent", "VIEW"],
  ["exception", "VIEW"],
  ["reconciliation", "VIEW"],
  ["telematics", "VIEW"],
  ["investigationCase", "VIEW"],
  ["investigationCase", "CREATE"],
  ["investigationCase", "EDIT"],
  ["investigationConfidentialAccess", "VIEW"],
];

export async function makeAnalyticsManagerSessionForTenant(tenant: Tenant) {
  return makeSessionForTenant(tenant, "Analytics Manager", ANALYTICS_MANAGER_PERMISSIONS);
}

export async function makeAnalyticsManagerSession() {
  const tenant = await createTenant("Analytics Tenant");
  const sessionInfo = await makeAnalyticsManagerSessionForTenant(tenant);
  return { tenant, ...sessionInfo };
}

export async function makeAnalyticsViewerSessionForTenant(tenant: Tenant) {
  return makeSessionForTenant(tenant, "Analytics Viewer", [
    ["governanceAnalytics", "VIEW"],
    ["analyticsIndicator", "VIEW"],
    ["analyticsRule", "VIEW"],
  ]);
}

export async function createOperationalAnalyticsFixture(tenant: Tenant, userId: string, at = new Date()) {
  const site = await createSite(tenant.id, "Analytics Site");
  const gate = await createGate(tenant.id, site.id, "Analytics Gate");
  const driver = await createDriver(tenant.id, { name: `Analytics Driver ${crypto.randomUUID()}` });
  const vehicle = await createVehicle(tenant.id, { registrationNumber: `ANA-${crypto.randomUUID().slice(0, 8)}` });
  const movement = await prisma.movementAuthorisation.create({
    data: {
      tenantId: tenant.id,
      siteId: site.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementType: "DELIVERY",
      expectedDepartureAt: new Date(at.getTime() - 4 * 60 * 60 * 1000),
      expectedReturnAt: new Date(at.getTime() - 2 * 60 * 60 * 1000),
      referenceCode: `ANA-${crypto.randomUUID()}`,
      requesterUserId: userId,
      status: "COMPLETED",
    },
  });
  const gateEvent = await prisma.gateEvent.create({
    data: {
      tenantId: tenant.id,
      siteId: site.id,
      gateId: gate.id,
      direction: "ENTRY",
      vehicleId: vehicle.id,
      driverId: driver.id,
      movementAuthorisationId: movement.id,
      securityOfficerUserId: userId,
      status: "COMPLETED",
      startedAt: new Date(at.getTime() - 3 * 60 * 60 * 1000),
      completedAt: at,
      decision: "CLEARED",
      decisionByUserId: userId,
      decisionAt: at,
    },
  });
  return { site, gate, driver, vehicle, movement, gateEvent };
}

export async function createExceptionSeries(input: {
  tenantId: string;
  gateEventId: string;
  raisedByUserId: string;
  count: number;
  at?: Date;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}) {
  const at = input.at ?? new Date();
  return Promise.all(Array.from({ length: input.count }, (_, index) => prisma.exception.create({
    data: {
      tenantId: input.tenantId,
      gateEventId: input.gateEventId,
      description: "Synthetic governance exception for deterministic analytics testing",
      severity: input.severity ?? "MEDIUM",
      raisedByUserId: input.raisedByUserId,
      raisedAt: new Date(at.getTime() - index * 60_000),
    },
  })));
}

export async function createInspectionFailureSeries(input: { tenantId: string; gateEventId: string; userId: string; count: number; at?: Date }) {
  const template = await prisma.inspectionTemplate.create({ data: { tenantId: input.tenantId, name: `Analytics Template ${crypto.randomUUID()}` } });
  const items = await Promise.all(Array.from({ length: input.count }, (_, index) => prisma.inspectionItem.create({ data: { templateId: template.id, section: "EXTERIOR_CONDITION", label: `Synthetic failure ${index}`, sortOrder: index } })));
  const at = input.at ?? new Date();
  return Promise.all(items.map((item, index) => prisma.gateEventInspectionItem.create({ data: { tenantId: input.tenantId, gateEventId: input.gateEventId, inspectionItemId: item.id, outcome: "FAIL", recordedByUserId: input.userId, recordedAt: new Date(at.getTime() - index * 60_000) } })));
}
