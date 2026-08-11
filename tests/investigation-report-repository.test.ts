import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { renderInvestigationReportPdf } from "@/lib/investigations/investigation-report-pdf";
import {
  beginInvestigation,
  createInvestigationCase,
  submitInvestigationCase,
  triageInvestigationCase,
} from "@/lib/repositories/investigation-case-repository";
import {
  approveInvestigationFinding,
  createInvestigationFinding,
  submitFindingForApproval,
} from "@/lib/repositories/investigation-finding-repository";
import { generateInvestigationReport } from "@/lib/repositories/investigation-report-repository";
import { getDefaultObjectStorageProvider } from "@/lib/repositories/media-asset-repository";
import { createTenant } from "./helpers/fixtures";
import { makeSessionForTenant } from "./helpers/billing-session";
import { makeInvestigatorSessionForTenant, makeManagerSessionForTenant } from "./helpers/investigation-fixtures";

function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  return Array.from(raw.matchAll(/<([0-9a-fA-F]+)>/g), (match) => Buffer.from(match[1], "hex").toString("latin1")).join("");
}

function countPdfPages(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
}

async function approvedFinding(
  outcome: "SUBSTANTIATED" | "UNSUBSTANTIATED" | "INCONCLUSIVE",
  description = "Allegation as reported",
) {
  const tenant = await createTenant(`Report ${outcome}`);
  const { session: manager } = await makeManagerSessionForTenant(tenant);
  const { session: investigator } = await makeInvestigatorSessionForTenant(tenant);
  const investigationCase = await createInvestigationCase(manager, { title: `${outcome} case`, description, source: "MANUAL_CONCERN" });
  await submitInvestigationCase(manager, investigationCase.id);
  await triageInvestigationCase(manager, investigationCase.id, {});
  await beginInvestigation(manager, investigationCase.id);
  const finding = await createInvestigationFinding(investigator, investigationCase.id, {
    executiveSummary: `${outcome} executive summary`,
    detailedFindings: `${outcome} detailed findings based on corroborated evidence.`,
    contradictoryEvidence: "Contradictory material was considered.",
    subjectResponseSummary: "The case subject response was considered separately.",
    outcome,
  });
  await submitFindingForApproval(investigator, investigationCase.id, finding.id);
  await approveInvestigationFinding(manager, investigationCase.id, finding.id, "Independent approval");
  return { tenant, manager, investigationCase, finding };
}

describe("investigation reports", () => {
  it.each(["SUBSTANTIATED", "UNSUBSTANTIATED", "INCONCLUSIVE"] as const)("renders and stores a valid professional PDF for %s", async (outcome) => {
    const { manager, investigationCase, finding } = await approvedFinding(outcome);
    const report = await generateInvestigationReport(manager, investigationCase.id, finding.id);
    const stored = await getDefaultObjectStorageProvider().read(report.storageKey);

    expect(report.ownerType).toBe("INVESTIGATION_REPORT");
    expect(report.contentType).toBe("application/pdf");
    expect(stored?.data.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const text = extractPdfText(stored!.data);
    expect(text).toContain("INVESTIGATION REPORT");
    expect(text).toContain(outcome);
    expect(text).toContain("Allegation as reported (not a finding of fact)");
    expect(text).not.toMatch(/biometric template|descriptor bytes|credential|password/i);
    expect(countPdfPages(stored!.data)).toBe(1);
  });

  it("filters restricted narrative and evidence server-side for a report requester without confidential access", async () => {
    const secret = "BIOMETRIC_TEMPLATE_SECRET_MUST_NOT_LEAK";
    const { tenant, manager, investigationCase, finding } = await approvedFinding("INCONCLUSIVE", secret);
    await prisma.investigationCase.update({ where: { id: investigationCase.id }, data: { confidentiality: "HIGHLY_RESTRICTED" } });
    await prisma.investigationEvidenceLink.create({
      data: {
        tenantId: tenant.id,
        caseId: investigationCase.id,
        evidenceNumber: 1,
        mediaAssetId: (
          await prisma.mediaAsset.create({
            data: {
              tenantId: tenant.id,
              ownerType: "INVESTIGATION_CASE",
              ownerId: investigationCase.id,
              capturedByUserId: manager.userId,
              fileName: "restricted.txt",
              contentType: "text/plain",
              fileSizeBytes: 1,
              storageKey: `${tenant.id}/test/${crypto.randomUUID()}`,
              checksumSha256: "0".repeat(64),
              idempotencyKey: crypto.randomUUID(),
            },
          })
        ).id,
        description: secret,
        confidentiality: "RESTRICTED",
        addedByUserId: manager.userId,
      },
    });
    const { session: restrictedReporter } = await makeSessionForTenant(tenant, "Restricted report creator", [
      ["investigationCase", "VIEW"],
      ["investigationReport", "CREATE"],
    ]);

    const report = await generateInvestigationReport(restrictedReporter, investigationCase.id, finding.id);
    const stored = await getDefaultObjectStorageProvider().read(report.storageKey);
    const pdfText = extractPdfText(stored!.data);
    expect(pdfText).toContain("Confidential ");
    expect(pdfText).not.toContain(secret);
  });

  it("lays out long chronology and findings across multiple pages with page numbering", async () => {
    const pdf = await renderInvestigationReportPdf({
      caseNumber: "INV-2030-000001",
      title: "Layout stress test",
      status: "CLOSED",
      confidentiality: "STANDARD",
      outcome: "INCONCLUSIVE",
      source: "MANUAL_CONCERN",
      priority: "MEDIUM",
      openedAt: new Date("2030-01-01T00:00:00Z"),
      caseOwnerName: "Case Owner",
      companyName: "Fictional Fleet Company",
      companyAddressLines: [],
      subjects: [],
      relatedRecords: [],
      allegation: "A neutral allegation. ".repeat(100),
      chronology: Array.from({ length: 80 }, (_, index) => ({ occurredAt: new Date("2030-01-02T00:00:00Z"), description: `Chronology entry ${index + 1}` })),
      evidenceManifest: [],
      findingVersion: 1,
      executiveSummary: "Summary",
      detailedFindings: "Detailed analysis. ".repeat(300),
      approvalInfo: { approvedByName: "Independent Approver", approvedAt: new Date("2030-01-03T00:00:00Z") },
      retentionHoldStatus: "Evidence hold ACTIVE",
      generatedAt: new Date("2030-01-04T00:00:00Z"),
      generatedByName: "Report Author",
    });
    expect(countPdfPages(pdf)).toBeGreaterThan(1);
    expect(extractPdfText(pdf)).toContain("Page 1 of");
  });
});
