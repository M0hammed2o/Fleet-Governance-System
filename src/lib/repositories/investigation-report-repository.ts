import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tenantWhere } from "@/lib/db/tenant-scope";
import { ForbiddenError, hasPermission, requirePermission } from "@/lib/auth/authorize";
import { recordInvestigationEvent } from "@/lib/investigations/investigation-audit";
import { renderInvestigationReportPdf } from "@/lib/investigations/investigation-report-pdf";
import { uploadMediaAsset, mintSignedUrlForMediaAsset } from "@/lib/repositories/media-asset-repository";
import { InvestigationCaseNotFoundError, canViewInvestigationCaseNarrative } from "@/lib/repositories/investigation-case-repository";
import type { AuthenticatedSession } from "@/lib/auth/session";

export class FindingNotApprovedForReportError extends Error {
  constructor() {
    super("A report can only be generated from an APPROVED finding.");
    this.name = "FindingNotApprovedForReportError";
  }
}
export class ReportNotFoundError extends Error {
  constructor() {
    super("Investigation report not found.");
    this.name = "ReportNotFoundError";
  }
}

async function gatherReportData(session: AuthenticatedSession, caseId: string, findingId: string, externalAuditorWatermark?: string | null) {
  const [investigationCase, finding, approval, subjects, relatedRecords, chronology, evidence, tenant] = await Promise.all([
    prisma.investigationCase.findFirst({
      where: tenantWhere(session.tenantId, { id: caseId }),
      include: { assignedInvestigator: { select: { name: true } }, caseOwner: { select: { name: true } } },
    }),
    prisma.investigationFinding.findFirst({ where: tenantWhere(session.tenantId, { id: findingId, caseId }) }),
    prisma.investigationApproval.findFirst({
      where: { tenantId: session.tenantId, findingId, action: "APPROVE" },
      orderBy: { createdAt: "desc" },
      include: { actor: { select: { name: true } } },
    }),
    prisma.investigationSubject.findMany({
      where: tenantWhere(session.tenantId, { caseId }),
      include: { user: { select: { name: true } }, driver: { select: { name: true } }, vehicle: { select: { registrationNumber: true } } },
    }),
    prisma.investigationRelatedRecord.findMany({ where: tenantWhere(session.tenantId, { caseId }) }),
    prisma.investigationChronologyEvent.findMany({ where: tenantWhere(session.tenantId, { caseId }), orderBy: { occurredAt: "asc" } }),
    prisma.investigationEvidenceLink.findMany({ where: tenantWhere(session.tenantId, { caseId }), orderBy: { evidenceNumber: "asc" } }),
    prisma.tenant.findUnique({ where: { id: session.tenantId } }),
  ]);

  if (!investigationCase) throw new InvestigationCaseNotFoundError();
  if (!finding || finding.status !== "APPROVED") throw new FindingNotApprovedForReportError();

  const generatedByUser = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
  const canSeeConfidential = await hasPermission(session, "investigationConfidentialAccess", "VIEW");
  const caseNarrativeRestricted = investigationCase.confidentiality !== "STANDARD" && !canSeeConfidential;
  const visibleEvidence = evidence.filter((item) => canSeeConfidential || item.confidentiality === "STANDARD");

  return {
    caseNumber: investigationCase.caseNumber,
    title: investigationCase.title,
    status: investigationCase.status,
    confidentiality: investigationCase.confidentiality,
    outcome: finding.outcome,
    source: investigationCase.source,
    category: investigationCase.category,
    priority: investigationCase.priority,
    openedAt: investigationCase.createdAt,
    closedAt: investigationCase.closedAt,
    investigatorName: investigationCase.assignedInvestigator?.name ?? null,
    caseOwnerName: investigationCase.caseOwner?.name ?? "-",
    companyName: tenant?.name ?? "-",
    companyAddressLines: [] as string[],
    subjects: caseNarrativeRestricted ? [] : subjects.map((s) => ({
      role: s.role,
      // Never a real name for a driver/user beyond what this tenant's own
      // staff already have access to elsewhere — neutral role label + best
      // available identifier, no biometric data (P11F/J).
      label: s.user?.name ?? s.driver?.name ?? s.vehicle?.registrationNumber ?? s.contractorName ?? s.department ?? s.site ?? "Unnamed party",
    })),
    relatedRecords: caseNarrativeRestricted ? [] : relatedRecords.map((r) => ({ recordType: r.recordType, summary: JSON.stringify(r.snapshotSummary) })),
    allegation: caseNarrativeRestricted ? "[Confidential — access restricted]" : investigationCase.description,
    chronology: caseNarrativeRestricted ? [] : chronology.map((c) => ({ occurredAt: c.occurredAt, description: c.description })),
    evidenceManifest: visibleEvidence.map((e) => ({ evidenceNumber: e.evidenceNumber, description: e.description, addedAt: e.addedAt, enteredInError: e.enteredInError })),
    findingVersion: finding.version,
    executiveSummary: caseNarrativeRestricted ? "[Confidential — access restricted]" : finding.executiveSummary,
    detailedFindings: caseNarrativeRestricted ? "[Confidential — access restricted]" : finding.detailedFindings,
    contradictoryEvidence: caseNarrativeRestricted ? null : finding.contradictoryEvidence,
    subjectResponseSummary: caseNarrativeRestricted ? null : finding.subjectResponseSummary,
    recommendations: caseNarrativeRestricted ? null : finding.recommendations,
    correctiveActions: caseNarrativeRestricted ? null : finding.correctiveActions,
    approvalInfo: approval ? { approvedByName: approval.actor?.name ?? "-", approvedAt: approval.createdAt } : null,
    retentionHoldStatus: investigationCase.evidenceHoldActive ? "Evidence hold ACTIVE" : "No active evidence hold",
    generatedAt: new Date(),
    generatedByName: generatedByUser?.name ?? "-",
    externalAuditorWatermark: externalAuditorWatermark ?? null,
  };
}

export interface GenerateReportOptions {
  externalAuditorWatermark?: string | null;
}

/** Generates and stores a new, immutable report PDF version for an APPROVED finding — a new finding version always means a new report generation (P11J). */
export async function generateInvestigationReport(session: AuthenticatedSession, caseId: string, findingId: string, options: GenerateReportOptions = {}) {
  await requirePermission(session, "investigationCase", "VIEW");
  await requirePermission(session, "investigationReport", "CREATE");

  const data = await gatherReportData(session, caseId, findingId, options.externalAuditorWatermark);
  const pdfBytes = await renderInvestigationReportPdf(data);

  const variant = options.externalAuditorWatermark ? `external-${Buffer.from(options.externalAuditorWatermark).toString("base64url").slice(0, 24)}` : "internal";
  const mediaAsset = await uploadMediaAsset({
    tenantId: session.tenantId,
    actorUserId: session.userId,
    ownerType: "INVESTIGATION_REPORT",
    ownerId: caseId,
    fileName: `${data.caseNumber}-v${data.findingVersion}-${variant}.pdf`,
    contentType: "application/pdf",
    data: pdfBytes,
    idempotencyKey: `investigation-report:${findingId}:${variant}`,
    category: "GENERATED_REPORT",
  });

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action: "investigation.reportGenerated",
    description: `Report generated (finding v${data.findingVersion}${options.externalAuditorWatermark ? ", external-auditor copy" : ""}).`,
    entityType: "MediaAsset",
    entityId: mediaAsset.id,
  });

  return mediaAsset;
}

export async function listInvestigationReports(session: AuthenticatedSession, caseId: string) {
  await requirePermission(session, "investigationCase", "VIEW");
  const existing = await prisma.investigationCase.findFirst({ where: tenantWhere(session.tenantId, { id: caseId }) });
  if (!existing) throw new InvestigationCaseNotFoundError();
  if (!(await canViewInvestigationCaseNarrative(session, caseId))) return [];

  return prisma.mediaAsset.findMany({
    where: { tenantId: session.tenantId, ownerType: "INVESTIGATION_REPORT", ownerId: caseId },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true, fileSizeBytes: true, checksumSha256: true, createdAt: true },
  });
}

export async function getInvestigationReportDownloadUrl(session: AuthenticatedSession, caseId: string, mediaAssetId: string) {
  await requirePermission(session, "investigationCase", "VIEW");
  await requirePermission(session, "investigationReport", "EXPORT");
  if (!(await canViewInvestigationCaseNarrative(session, caseId))) {
    throw new ForbiddenError("investigationConfidentialAccess", "VIEW");
  }
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaAssetId, tenantId: session.tenantId, ownerType: "INVESTIGATION_REPORT", ownerId: caseId } });
  if (!asset) throw new ReportNotFoundError();

  await recordInvestigationEvent({
    tenantId: session.tenantId,
    caseId,
    actorUserId: session.userId,
    action: "investigation.reportDownloaded",
    description: "Report downloaded.",
    entityType: "MediaAsset",
    entityId: mediaAssetId,
  });

  return mintSignedUrlForMediaAsset(session.tenantId, session.userId, mediaAssetId);
}
