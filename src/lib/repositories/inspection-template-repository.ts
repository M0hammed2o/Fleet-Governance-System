import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { recordAudit } from "@/lib/audit/record-audit";
import type { VehicleCategory, InspectionSection, InspectionResponseType, ExceptionSeverity } from "@/generated/prisma/client";

export async function listInspectionTemplatesInTenant(tenantId: string, options: { activeOnly?: boolean } = {}) {
  return prisma.inspectionTemplate.findMany({
    where: tenantWhere(tenantId, options.activeOnly ? { isActive: true } : {}),
    orderBy: [{ name: "asc" }, { version: "desc" }],
    include: { items: { orderBy: [{ section: "asc" }, { sortOrder: "asc" }] } },
  });
}

export async function getInspectionTemplateInTenant(tenantId: string, templateId: string) {
  return prisma.inspectionTemplate.findFirst({
    where: tenantWhere(tenantId, { id: templateId }),
    include: { items: { orderBy: [{ section: "asc" }, { sortOrder: "asc" }] } },
  });
}

/**
 * Picks the template a GateEvent should default to for a given vehicle
 * category: the tenant's active category-specific template if one exists,
 * else the tenant's active generic (vehicleCategory = null) template. Build
 * brief GATE-006: "template varies by vehicle type/version; not hardcoded to
 * one component" — this is the only place that decision is made, and it's a
 * plain query, not a hardcoded mapping.
 */
export async function getActiveTemplateForCategory(tenantId: string, category: VehicleCategory) {
  const specific = await prisma.inspectionTemplate.findFirst({
    where: tenantWhere(tenantId, { isActive: true, vehicleCategory: category }),
    orderBy: { version: "desc" },
    include: { items: { orderBy: [{ section: "asc" }, { sortOrder: "asc" }] } },
  });
  if (specific) return specific;

  return prisma.inspectionTemplate.findFirst({
    where: tenantWhere(tenantId, { isActive: true, vehicleCategory: null }),
    orderBy: { version: "desc" },
    include: { items: { orderBy: [{ section: "asc" }, { sortOrder: "asc" }] } },
  });
}

export interface InspectionItemInput {
  section: InspectionSection;
  label: string;
  description?: string | null;
  responseType?: InspectionResponseType;
  unit?: string | null;
  isRequired?: boolean;
  defaultExceptionSeverity?: ExceptionSeverity | null;
  requiresSupervisorApprovalOnFail?: boolean;
}

export interface CreateInspectionTemplateInput {
  tenantId: string;
  name: string;
  description?: string | null;
  vehicleCategory?: VehicleCategory | null;
  items: InspectionItemInput[];
  actorUserId: string;
  isSystem?: boolean;
}

/**
 * Creates a brand-new template (version 1). To publish a new version of an
 * existing template, use `createNewTemplateVersion` instead — this function
 * always starts a fresh name/version lineage.
 */
export async function createInspectionTemplate(input: CreateInspectionTemplateInput) {
  // P11-000 (DECISIONS.md D-038): items are created via a separate,
  // explicit createMany() rather than a nested `items: { create: [...] }`
  // write — a multi-item nested relational create, interpreted by Prisma's
  // query-compiler runtime inside its own implicit transaction, was traced
  // as a source of pg's "client.query() when the client is already
  // executing a query" deprecation warning under real load.
  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.inspectionTemplate.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        description: input.description ?? null,
        vehicleCategory: input.vehicleCategory ?? null,
        version: 1,
        isActive: true,
        isSystem: input.isSystem ?? false,
      },
    });
    await tx.inspectionItem.createMany({
      data: input.items.map((item, index) => ({
        templateId: created.id,
        section: item.section,
        label: item.label,
        description: item.description ?? null,
        sortOrder: index,
        responseType: item.responseType ?? "CHECK",
        unit: item.unit ?? null,
        isRequired: item.isRequired ?? true,
        defaultExceptionSeverity: item.defaultExceptionSeverity ?? null,
        requiresSupervisorApprovalOnFail: item.requiresSupervisorApprovalOnFail ?? false,
      })),
    });
    const items = await tx.inspectionItem.findMany({ where: { templateId: created.id }, orderBy: { sortOrder: "asc" } });
    return { ...created, items };
  });

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: "inspectionTemplate.created",
    entityType: "InspectionTemplate",
    entityId: template.id,
    afterValue: { name: template.name, version: template.version, itemCount: template.items.length },
  });

  return template;
}

/**
 * Publishes a new version of an existing template: creates a new row with
 * version incremented, and deactivates the previous active version so
 * `getActiveTemplateForCategory` picks it up going forward — existing
 * GateEvents keep pointing at their original template version (see
 * ARCHITECTURE.md "Gate operations architecture").
 */
export async function createNewTemplateVersion(
  tenantId: string,
  previousTemplateId: string,
  input: Omit<CreateInspectionTemplateInput, "tenantId" | "name" | "vehicleCategory">,
) {
  const previous = await prisma.inspectionTemplate.findFirst({ where: tenantWhere(tenantId, { id: previousTemplateId }) });
  if (!previous) return null;

  // P11-000 (DECISIONS.md D-038): an explicit interactive transaction with a
  // separate createMany() for items, replacing both the nested
  // `items: { create: [...] }` write and the array-style (non-interactive)
  // `$transaction([...])` batch API — array-style batched operations are
  // sent together without this code controlling their exact sequencing
  // against the driver-adapter's pinned transaction client, the same class
  // of issue as the nested-create nested-write nested pattern above.
  const created = await prisma.$transaction(async (tx) => {
    const createdTemplate = await tx.inspectionTemplate.create({
      data: {
        tenantId,
        name: previous.name,
        description: input.description ?? previous.description,
        vehicleCategory: previous.vehicleCategory,
        version: previous.version + 1,
        isActive: true,
        isSystem: previous.isSystem,
      },
    });
    await tx.inspectionItem.createMany({
      data: input.items.map((item, index) => ({
        templateId: createdTemplate.id,
        section: item.section,
        label: item.label,
        description: item.description ?? null,
        sortOrder: index,
        responseType: item.responseType ?? "CHECK",
        unit: item.unit ?? null,
        isRequired: item.isRequired ?? true,
        defaultExceptionSeverity: item.defaultExceptionSeverity ?? null,
        requiresSupervisorApprovalOnFail: item.requiresSupervisorApprovalOnFail ?? false,
      })),
    });
    await tx.inspectionTemplate.update({ where: { id: previous.id }, data: { isActive: false } });
    const items = await tx.inspectionItem.findMany({ where: { templateId: createdTemplate.id }, orderBy: { sortOrder: "asc" } });
    return { ...createdTemplate, items };
  });

  await recordAudit({
    tenantId,
    userId: input.actorUserId,
    action: "inspectionTemplate.newVersionPublished",
    entityType: "InspectionTemplate",
    entityId: created.id,
    beforeValue: { previousTemplateId: previous.id, previousVersion: previous.version },
    afterValue: { name: created.name, version: created.version },
  });

  return created;
}

export async function setInspectionTemplateActive(tenantId: string, templateId: string, isActive: boolean, actorUserId: string) {
  const result = await prisma.inspectionTemplate.updateMany({
    where: tenantWhere(tenantId, { id: templateId }),
    data: { isActive },
  });
  if (result.count === 0) return false;

  await recordAudit({
    tenantId,
    userId: actorUserId,
    action: isActive ? "inspectionTemplate.activated" : "inspectionTemplate.deactivated",
    entityType: "InspectionTemplate",
    entityId: templateId,
    afterValue: { isActive },
  });
  return true;
}
