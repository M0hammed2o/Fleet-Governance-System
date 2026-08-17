import "server-only";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record-audit";
import type { Prisma } from "@/generated/prisma/client";
import type { OnboardingUpdateInput } from "@/lib/validation/demo";

export async function getOnboardingSummary(tenantId: string) {
  const [tenant, progress, loadedVehicles, drivers, sites, gates, staff, assignments] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, slug: true, companyRegistrationNumber: true, industry: true, contactEmail: true, contactPhone: true, address: true, departments: true, demoWorkspace: true, demoDisclosureVersion: true } }),
    prisma.tenantOnboarding.findUnique({ where: { tenantId } }),
    prisma.vehicle.count({ where: { tenantId, archivedAt: null } }),
    prisma.driver.count({ where: { tenantId, archivedAt: null } }),
    prisma.site.count({ where: { tenantId, archivedAt: null } }),
    prisma.gate.count({ where: { tenantId, archivedAt: null } }),
    prisma.user.count({ where: { tenantId } }),
    prisma.driverVehicleAssignment.count({ where: { tenantId, status: "ACTIVE", effectiveTo: null } }),
  ]);
  if (!tenant) return null;
  const onboarding = progress ?? await prisma.tenantOnboarding.create({ data: { tenantId } });
  const declaredFleetSize = onboarding.declaredFleetSize ?? 0;
  const readiness = {
    company: Boolean(tenant.name && tenant.industry),
    fleet: onboarding.declaredFleetSize !== null,
    sites: sites > 0 && gates > 0,
    vehicles: loadedVehicles > 0,
    drivers: drivers > 0,
    staff: staff > 1,
    assignments: assignments > 0,
  };
  return {
    tenant,
    onboarding,
    counts: {
      declaredFleetSize,
      loadedVehicles,
      outstandingVehicles: Math.max(0, declaredFleetSize - loadedVehicles),
      drivers,
      sites,
      gates,
      staff,
      assignments,
    },
    readiness,
  };
}

export async function updateOnboarding(tenantId: string, actorUserId: string, input: OnboardingUpdateInput) {
  return prisma.$transaction(async (tx) => {
    if (input.company) {
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          name: input.company.name,
          companyRegistrationNumber: input.company.companyRegistrationNumber,
          industry: input.company.industry,
          contactEmail: input.company.contactEmail,
          contactPhone: input.company.contactPhone,
          address: input.company.address,
          departments: input.company.departments,
        },
      });
    }
    const data: Prisma.TenantOnboardingUpdateInput = {};
    if (input.currentStep !== undefined) data.currentStep = input.currentStep;
    if (input.completedSections !== undefined) data.completedSections = [...new Set(input.completedSections)];
    if (input.fleet) {
      data.declaredFleetSize = input.fleet.declaredFleetSize;
      data.fleetComposition = input.fleet.fleetComposition as Prisma.InputJsonValue;
    }
    if (input.complete) {
      data.completedAt = new Date();
      data.currentStep = 8;
    }
    const progress = await tx.tenantOnboarding.upsert({
      where: { tenantId },
      create: { tenantId, ...data } as Prisma.TenantOnboardingUncheckedCreateInput,
      update: data,
    });
    await recordAudit({
      tenantId,
      userId: actorUserId,
      action: input.complete ? "demo.onboardingCompleted" : "demo.onboardingSaved",
      entityType: "TenantOnboarding",
      entityId: progress.id,
      afterValue: { currentStep: progress.currentStep, completedSections: progress.completedSections, declaredFleetSize: progress.declaredFleetSize, completed: Boolean(progress.completedAt) },
    }, tx);
    return progress;
  });
}
