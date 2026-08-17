import "server-only";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/record-audit";
import { listAllPermissions, permissionKey, type PermissionAction, type PermissionResource } from "@/lib/auth/permissions";
import { DEMO_DISCLOSURE_VERSION, type DemoRegistrationInput } from "@/lib/validation/demo";

const DEMO_ADMIN_PERMISSIONS: ReadonlyArray<[PermissionResource, PermissionAction]> = [
  ["tenant", "VIEW"], ["tenant", "CONFIGURE"],
  ["site", "VIEW"], ["site", "CREATE"], ["site", "EDIT"], ["site", "DELETE"], ["site", "CONFIGURE"],
  ["gate", "VIEW"], ["gate", "CREATE"], ["gate", "EDIT"], ["gate", "DELETE"], ["gate", "CONFIGURE"],
  ["user", "VIEW"], ["user", "CREATE"], ["user", "EDIT"], ["user", "DELETE"], ["user", "CONFIGURE"],
  ["role", "VIEW"], ["role", "CREATE"], ["role", "EDIT"], ["role", "DELETE"], ["role", "CONFIGURE"],
  ["driver", "VIEW"], ["driver", "CREATE"], ["driver", "EDIT"], ["driver", "DELETE"], ["driver", "EXPORT"],
  ["vehicle", "VIEW"], ["vehicle", "CREATE"], ["vehicle", "EDIT"], ["vehicle", "DELETE"], ["vehicle", "EXPORT"],
  ["complianceDocument", "VIEW"], ["complianceDocument", "CREATE"], ["complianceDocument", "EDIT"], ["complianceDocument", "DELETE"], ["complianceDocument", "AUDIT"],
  ["mediaAsset", "VIEW"], ["mediaAsset", "CREATE"], ["mediaAsset", "DELETE"],
  ["auditLog", "VIEW"], ["auditLog", "EXPORT"],
  ["gateEvent", "VIEW"], ["exception", "VIEW"], ["reconciliation", "VIEW"], ["telematics", "VIEW"],
  ["governanceAnalytics", "VIEW"], ["analyticsIndicator", "VIEW"], ["analyticsRule", "VIEW"],
  ["facialVerificationFallback", "VIEW"], ["facialVerificationFallback", "APPROVE"], ["facialVerificationFallback", "REJECT"],
  ["facialTemplate", "VIEW"], ["facialTemplate", "CREATE"], ["facialTemplate", "DELETE"],
  ["facialVerificationAttempt", "VIEW"],
];

const DEMO_OPERATIONAL_ROLES: ReadonlyArray<{ name: string; description: string; permissions: ReadonlyArray<[PermissionResource, PermissionAction]> }> = [
  { name: "Dispatch and Logistics Officer", description: "Plans and submits fleet movements without approving their own requests.", permissions: [["site", "VIEW"], ["gate", "VIEW"], ["driver", "VIEW"], ["vehicle", "VIEW"], ["movement", "VIEW"], ["movement", "CREATE"], ["movement", "EDIT"]] },
  { name: "Gate Security Officer", description: "Performs approved gate checks after independent staff approval.", permissions: [["site", "VIEW"], ["gate", "VIEW"], ["driver", "VIEW"], ["vehicle", "VIEW"], ["movement", "VIEW"], ["gateEvent", "VIEW"], ["gateEvent", "CREATE"], ["gateEvent", "EDIT"], ["exception", "CREATE"], ["mediaAsset", "VIEW"], ["mediaAsset", "CREATE"], ["facialVerificationAttempt", "CREATE"], ["facialVerificationFallback", "CREATE"]] },
  { name: "Security Supervisor / Approving Manager", description: "Independently approves controlled operational decisions and guard access.", permissions: [["site", "VIEW"], ["gate", "VIEW"], ["user", "VIEW"], ["user", "CONFIGURE"], ["driver", "VIEW"], ["vehicle", "VIEW"], ["movement", "VIEW"], ["movement", "APPROVE"], ["movement", "REJECT"], ["gateEvent", "VIEW"], ["gateEvent", "APPROVE"], ["exception", "VIEW"], ["exception", "APPROVE"], ["facialVerificationFallback", "VIEW"], ["facialVerificationFallback", "APPROVE"], ["facialVerificationFallback", "REJECT"]] },
  { name: "Fleet and GPS Manager", description: "Maintains driver, vehicle, document, assignment and synthetic tracker master data.", permissions: [["site", "VIEW"], ["gate", "VIEW"], ["driver", "VIEW"], ["driver", "CREATE"], ["driver", "EDIT"], ["driver", "DELETE"], ["vehicle", "VIEW"], ["vehicle", "CREATE"], ["vehicle", "EDIT"], ["vehicle", "DELETE"], ["complianceDocument", "VIEW"], ["complianceDocument", "CREATE"], ["complianceDocument", "EDIT"], ["complianceDocument", "DELETE"], ["mediaAsset", "VIEW"], ["mediaAsset", "CREATE"], ["mediaAsset", "DELETE"], ["telematics", "VIEW"], ["telematics", "CREATE"], ["telematics", "CONFIGURE"]] },
  { name: "Accountant / Finance and Compliance Officer", description: "Reviews compliance and tenant billing without altering gate evidence.", permissions: [["driver", "VIEW"], ["vehicle", "VIEW"], ["complianceDocument", "VIEW"], ["complianceDocument", "AUDIT"], ["tenantBilling", "VIEW"], ["invoice", "VIEW"], ["payment", "VIEW"], ["governanceAnalytics", "VIEW"]] },
  { name: "Internal Investigator / Auditor", description: "Reviews audit history, evidence and authorised investigation records.", permissions: [["driver", "VIEW"], ["vehicle", "VIEW"], ["gateEvent", "VIEW"], ["exception", "VIEW"], ["auditLog", "VIEW"], ["auditLog", "EXPORT"], ["mediaAsset", "VIEW"], ["investigationCase", "VIEW"], ["investigationCase", "CREATE"], ["investigationCase", "EDIT"], ["investigationFinding", "CREATE"], ["investigationFinding", "EDIT"]] },
  { name: "Executive Viewer", description: "Read-only executive fleet and governance overview.", permissions: [["tenant", "VIEW"], ["driver", "VIEW"], ["vehicle", "VIEW"], ["gateEvent", "VIEW"], ["exception", "VIEW"], ["governanceAnalytics", "VIEW"], ["analyticsIndicator", "VIEW"]] },
  { name: "External Auditor", description: "Restricted portal access only when a separate active case grant exists.", permissions: [["externalAuditorPortal", "VIEW"], ["externalAuditorPortal", "EXPORT"]] },
];

export class DemoRegistrationRejectedError extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

export async function provisionDemoWorkspace(input: DemoRegistrationInput): Promise<{ token: string; tenantSlug: string }> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const duplicate = await tx.user.findFirst({ where: { email: input.email }, select: { id: true } });
      const slugDuplicate = await tx.tenant.findUnique({ where: { slug: input.workspaceSlug }, select: { id: true } });
      if (duplicate || slugDuplicate) throw new DemoRegistrationRejectedError();

      for (const entry of listAllPermissions()) {
        await tx.permission.upsert({
          where: { resource_action: entry },
          update: {},
          create: { ...entry, description: `${entry.action} ${entry.resource}` },
        });
      }
      const permissionRows = await tx.permission.findMany({
        where: { OR: DEMO_ADMIN_PERMISSIONS.map(([resource, action]) => ({ resource, action })) },
        select: { id: true, resource: true, action: true },
      });
      const requiredKeys = new Set(DEMO_ADMIN_PERMISSIONS.map(([resource, action]) => permissionKey(resource, action)));
      const actualKeys = new Set(permissionRows.map((row) => permissionKey(row.resource, row.action)));
      if ([...requiredKeys].some((key) => !actualKeys.has(key))) throw new Error("The permission catalogue is incomplete.");

      const acceptedAt = new Date();
      const tenant = await tx.tenant.create({
        data: {
          name: input.companyName,
          slug: input.workspaceSlug,
          industry: input.industry || null,
          companyRegistrationNumber: input.companyRegistrationNumber || null,
          contactEmail: input.email,
          contactPhone: input.contactPhone || null,
          address: input.address || null,
          demoWorkspace: true,
          demoTermsAcceptedAt: acceptedAt,
          demoDisclosureVersion: DEMO_DISCLOSURE_VERSION,
        },
      });
      const templates = [
        { name: "Company Administrator", description: "Configures the demonstration company, fleet, staff and governance controls.", permissions: DEMO_ADMIN_PERMISSIONS },
        ...DEMO_OPERATIONAL_ROLES,
      ];
      let administratorRoleId = "";
      for (const template of templates) {
        const role = await tx.role.create({ data: { tenantId: tenant.id, name: template.name, description: template.description, isSystem: true } });
        if (template.name === "Company Administrator") administratorRoleId = role.id;
        const templateKeys = new Set(template.permissions.map(([resource, action]) => permissionKey(resource, action)));
        const ids = permissionRows.filter((row) => templateKeys.has(permissionKey(row.resource, row.action))).map((row) => ({ roleId: role.id, permissionId: row.id }));
        if (ids.length !== templateKeys.size) {
          const extraRows = await tx.permission.findMany({ where: { OR: template.permissions.map(([resource, action]) => ({ resource, action })) }, select: { id: true } });
          await tx.rolePermission.createMany({ data: extraRows.map((row) => ({ roleId: role.id, permissionId: row.id })) });
        } else {
          await tx.rolePermission.createMany({ data: ids });
        }
      }
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          roleId: administratorRoleId,
          email: input.email,
          name: input.administratorName,
          passwordHash,
          status: "ACTIVE",
          approvalStatus: "APPROVED",
          approvedAt: acceptedAt,
        },
      });
      await tx.tenantOnboarding.create({ data: { tenantId: tenant.id, currentStep: 1, completedSections: [] } });
      const token = await createSession({ tenantId: tenant.id, userId: user.id }, tx);
      await recordAudit({
        tenantId: tenant.id,
        userId: user.id,
        action: "demo.workspaceProvisioned",
        entityType: "Tenant",
        entityId: tenant.id,
        afterValue: { demoWorkspace: true, disclosureVersion: DEMO_DISCLOSURE_VERSION, firstAdministratorCreated: true },
        reason: "Controlled self-service demonstration registration",
      }, tx);
      return { token, tenantSlug: tenant.slug };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof DemoRegistrationRejectedError || isUniqueViolation(error)) throw new DemoRegistrationRejectedError();
    throw error;
  }
}
