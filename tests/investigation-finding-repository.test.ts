import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  beginInvestigation,
  closeInvestigationCase,
  createInvestigationCase,
  submitInvestigationCase,
  triageInvestigationCase,
} from "@/lib/repositories/investigation-case-repository";
import {
  FindingNotFoundError,
  FindingNotSubmittableError,
  SameActorCannotApproveOwnFindingError,
  approveInvestigationFinding,
  createAmendedFindingVersion,
  createInvestigationFinding,
  rejectInvestigationFinding,
  returnFindingForAmendment,
  submitFindingForApproval,
  updateDraftFinding,
} from "@/lib/repositories/investigation-finding-repository";
import { createTenant, grantPermission } from "./helpers/fixtures";
import { makeInvestigatorSessionForTenant, makeManagerSessionForTenant } from "./helpers/investigation-fixtures";

async function openWorkingCase(manager: Awaited<ReturnType<typeof makeManagerSessionForTenant>>["session"]) {
  const investigationCase = await createInvestigationCase(manager, { title: "Finding case", description: "Allegation remains unproven", source: "MANUAL_CONCERN" });
  await submitInvestigationCase(manager, investigationCase.id);
  await triageInvestigationCase(manager, investigationCase.id, {});
  await beginInvestigation(manager, investigationCase.id);
  return investigationCase;
}

describe("investigation findings and approval separation", () => {
  it.each(["SUBSTANTIATED", "UNSUBSTANTIATED", "INCONCLUSIVE"] as const)("supports the %s outcome through approval and closure", async (outcome) => {
    const tenant = await createTenant(`Finding ${outcome}`);
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const { session: investigator } = await makeInvestigatorSessionForTenant(tenant);
    const investigationCase = await openWorkingCase(manager);

    const finding = await createInvestigationFinding(investigator, investigationCase.id, {
      executiveSummary: `${outcome} summary`,
      detailedFindings: "Evidence and the subject response were considered.",
      outcome,
    });
    await submitFindingForApproval(investigator, investigationCase.id, finding.id);
    await approveInvestigationFinding(manager, investigationCase.id, finding.id, "Independent review complete");
    const closed = await closeInvestigationCase(manager, investigationCase.id, { approvedFindingId: finding.id });

    expect(closed.outcome).toBe(outcome);
    expect(closed.closedByUserId).toBe(manager.userId);
    expect(closed.closedAt).not.toBeNull();
  });

  it("requires a determined outcome before a draft can be submitted", async () => {
    const tenant = await createTenant("Neutral finding");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const { session: investigator } = await makeInvestigatorSessionForTenant(tenant);
    const investigationCase = await openWorkingCase(manager);
    const finding = await createInvestigationFinding(investigator, investigationCase.id, {
      executiveSummary: "Not ready",
      detailedFindings: "Still being assessed",
      outcome: "NOT_DETERMINED",
    });

    await expect(submitFindingForApproval(investigator, investigationCase.id, finding.id)).rejects.toBeInstanceOf(FindingNotSubmittableError);
    expect((await prisma.investigationCase.findUniqueOrThrow({ where: { id: investigationCase.id } })).status).toBe("UNDER_INVESTIGATION");
  });

  it("blocks self-approval even when the author also holds approval permission", async () => {
    const tenant = await createTenant("Self approval");
    const managerActor = await makeManagerSessionForTenant(tenant);
    await grantPermission(managerActor.role.id, "investigationFinding", "CREATE");
    const investigationCase = await openWorkingCase(managerActor.session);
    const finding = await createInvestigationFinding(managerActor.session, investigationCase.id, {
      executiveSummary: "Author summary",
      detailedFindings: "Author detail",
      outcome: "INCONCLUSIVE",
    });
    await submitFindingForApproval(managerActor.session, investigationCase.id, finding.id);

    await expect(approveInvestigationFinding(managerActor.session, investigationCase.id, finding.id)).rejects.toBeInstanceOf(SameActorCannotApproveOwnFindingError);
    expect((await prisma.investigationFinding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe("SUBMITTED");
  });

  it("records return and rejection reasons append-only, and amendments create a new version", async () => {
    const tenant = await createTenant("Finding amendments");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const { session: investigator } = await makeInvestigatorSessionForTenant(tenant);
    const investigationCase = await openWorkingCase(manager);
    const v1 = await createInvestigationFinding(investigator, investigationCase.id, {
      executiveSummary: "Version one",
      detailedFindings: "Version one details",
      outcome: "UNSUBSTANTIATED",
    });
    await submitFindingForApproval(investigator, investigationCase.id, v1.id);
    await returnFindingForAmendment(manager, investigationCase.id, v1.id, "Address contradictory evidence");

    const v2 = await createAmendedFindingVersion(investigator, investigationCase.id, v1.id, {
      executiveSummary: "Version two",
      detailedFindings: "Expanded analysis",
      outcome: "INCONCLUSIVE",
    });
    await submitFindingForApproval(investigator, investigationCase.id, v2.id);
    await rejectInvestigationFinding(manager, investigationCase.id, v2.id, "Insufficient corroboration");

    expect(v2.version).toBe(2);
    expect((await prisma.investigationFinding.findUniqueOrThrow({ where: { id: v1.id } })).executiveSummary).toBe("Version one");
    const decisions = await prisma.investigationApproval.findMany({ where: { caseId: investigationCase.id }, orderBy: { createdAt: "asc" } });
    expect(decisions.filter((decision) => decision.action === "RETURN_FOR_AMENDMENT")[0]?.reason).toBe("Address contradictory evidence");
    expect(decisions.filter((decision) => decision.action === "REJECT")[0]?.reason).toBe("Insufficient corroboration");
  });

  it("rejects a finding id placed under a different case id", async () => {
    const tenant = await createTenant("Cross case finding");
    const { session: manager } = await makeManagerSessionForTenant(tenant);
    const { session: investigator } = await makeInvestigatorSessionForTenant(tenant);
    const caseA = await openWorkingCase(manager);
    const caseB = await openWorkingCase(manager);
    const finding = await createInvestigationFinding(investigator, caseA.id, {
      executiveSummary: "Case A",
      detailedFindings: "Case A only",
      outcome: "SUBSTANTIATED",
    });

    await expect(updateDraftFinding(investigator, caseB.id, finding.id, { executiveSummary: "wrong case" })).rejects.toBeInstanceOf(FindingNotFoundError);
    await expect(submitFindingForApproval(investigator, caseB.id, finding.id)).rejects.toBeInstanceOf(FindingNotFoundError);
  });
});
