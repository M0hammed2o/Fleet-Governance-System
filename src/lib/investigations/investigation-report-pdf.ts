import "server-only";
import PDFDocument from "pdfkit";

/**
 * Renders an immutable investigation-case report snapshot to PDF bytes,
 * same pdfkit shape/approach as billing/invoice-pdf.ts (D-037's
 * serverExternalPackages fix applies here too — no separate font-path
 * issue expected since this reuses the identical pattern). Deliberately
 * never receives biometric template/descriptor data as an input field —
 * see investigation-report-repository.ts's gatherReportData(), which never
 * reads FacialVerificationAttempt/DriverFacialTemplate raw fields (P11F/J
 * hard requirement).
 */

export interface InvestigationReportSubject {
  role: string;
  label: string;
}
export interface InvestigationReportRelatedRecord {
  recordType: string;
  summary: string;
}
export interface InvestigationReportChronologyEntry {
  occurredAt: Date;
  description: string;
}
export interface InvestigationReportEvidenceEntry {
  evidenceNumber: number;
  description: string;
  addedAt: Date;
  enteredInError: boolean;
}
export interface InvestigationReportApprovalInfo {
  approvedByName: string;
  approvedAt: Date;
}

export interface InvestigationReportPdfInput {
  caseNumber: string;
  title: string;
  status: string;
  confidentiality: string;
  outcome: string;
  source: string;
  category?: string | null;
  priority: string;
  openedAt: Date;
  closedAt?: Date | null;
  investigatorName?: string | null;
  caseOwnerName: string;
  companyName: string;
  companyAddressLines: string[];
  subjects: InvestigationReportSubject[];
  relatedRecords: InvestigationReportRelatedRecord[];
  allegation: string;
  chronology: InvestigationReportChronologyEntry[];
  evidenceManifest: InvestigationReportEvidenceEntry[];
  findingVersion: number;
  executiveSummary: string;
  detailedFindings: string;
  contradictoryEvidence?: string | null;
  subjectResponseSummary?: string | null;
  recommendations?: string | null;
  correctiveActions?: string | null;
  approvalInfo?: InvestigationReportApprovalInfo | null;
  retentionHoldStatus: string;
  generatedAt: Date;
  generatedByName: string;
  /** Set only when rendering a copy for a specific external-auditor grant (P11J "optional external-auditor watermark"). */
  externalAuditorWatermark?: string | null;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function renderInvestigationReportPdf(input: InvestigationReportPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50, size: "A4", bufferPages: true, compress: false });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const heading = (text: string) => {
    doc.moveDown(0.8);
    doc.fontSize(12).fillColor("#000").font("Helvetica-Bold").text(text, { underline: true });
    doc.font("Helvetica").fontSize(9).fillColor("#333");
  };

  // --- Header ---------------------------------------------------------------
  doc.fontSize(18).fillColor("#000").font("Helvetica-Bold").text("INVESTIGATION REPORT", { align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor("#555").text(input.caseNumber, { align: "right" });
  doc.fontSize(9).fillColor(input.confidentiality === "STANDARD" ? "#888" : "#b00").text(`Confidentiality: ${input.confidentiality}`, { align: "right" });
  doc.moveDown(0.5);

  doc.fontSize(12).fillColor("#000").text(input.companyName);
  doc.fontSize(9).fillColor("#333");
  for (const line of input.companyAddressLines) doc.text(line);

  doc.moveDown(1);
  doc.fontSize(14).fillColor("#000").font("Helvetica-Bold").text(input.title);
  doc.font("Helvetica").fontSize(9).fillColor("#333");
  doc.text(`Status: ${input.status}    Outcome: ${input.outcome}    Priority: ${input.priority}`);
  doc.text(`Source: ${input.source}${input.category ? `    Category: ${input.category}` : ""}`);
  doc.text(`Opened: ${fmtDate(input.openedAt)}${input.closedAt ? `    Closed: ${fmtDate(input.closedAt)}` : ""}`);
  doc.text(`Case owner: ${input.caseOwnerName}${input.investigatorName ? `    Investigator: ${input.investigatorName}` : ""}`);
  doc.text(`Retention/hold status: ${input.retentionHoldStatus}`);

  // --- Allegation (kept clearly separate from findings, never presented as fact) ---
  heading("Allegation as reported (not a finding of fact)");
  doc.text(input.allegation);

  // --- Subjects — neutral wording only ("case subject", never "guilty") ---
  heading("Case subjects");
  if (input.subjects.length === 0) doc.text("None recorded.");
  for (const s of input.subjects) doc.text(`- ${s.role}: ${s.label}`);

  // --- Related records ---
  heading("Related operational records");
  if (input.relatedRecords.length === 0) doc.text("None recorded.");
  for (const r of input.relatedRecords) doc.text(`- [${r.recordType}] ${r.summary}`);

  // --- Findings ---
  heading(`Findings (version ${input.findingVersion})`);
  doc.font("Helvetica-Bold").text("Executive summary");
  doc.font("Helvetica").text(input.executiveSummary);
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").text("Detailed findings");
  doc.font("Helvetica").text(input.detailedFindings);
  if (input.contradictoryEvidence) {
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").text("Contradictory evidence considered");
    doc.font("Helvetica").text(input.contradictoryEvidence);
  }
  if (input.subjectResponseSummary) {
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").text("Subject response");
    doc.font("Helvetica").text(input.subjectResponseSummary);
  }
  if (input.recommendations) {
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").text("Recommendations");
    doc.font("Helvetica").text(input.recommendations);
  }
  if (input.correctiveActions) {
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").text("Corrective actions");
    doc.font("Helvetica").text(input.correctiveActions);
  }

  // --- Evidence manifest — descriptive metadata only, never raw file bytes/biometrics ---
  heading("Evidence manifest");
  if (input.evidenceManifest.length === 0) doc.text("No evidence linked.");
  for (const e of input.evidenceManifest) {
    doc.text(`#${e.evidenceNumber} — ${e.description} (added ${fmtDate(e.addedAt)})${e.enteredInError ? " [ENTERED IN ERROR]" : ""}`);
  }

  // --- Chronology ---
  heading("Chronology");
  for (const c of input.chronology) doc.text(`${fmtDate(c.occurredAt)} — ${c.description}`);

  // --- Approval ---
  heading("Approval");
  if (input.approvalInfo) {
    doc.text(`Approved by ${input.approvalInfo.approvedByName} on ${fmtDate(input.approvalInfo.approvedAt)}.`);
  } else {
    doc.text("Not yet approved.");
  }

  doc.moveDown(1);
  doc.fontSize(8).fillColor("#888").text(`Generated ${input.generatedAt.toISOString()} by ${input.generatedByName}. Version ${input.findingVersion}.`);

  if (input.externalAuditorWatermark) {
    doc.fontSize(24).fillColor("#e0b0b0").rotate(-30, { origin: [300, 400] });
    doc.text(input.externalAuditorWatermark, 100, 380, { align: "center", width: 400 });
    doc.rotate(30, { origin: [300, 400] });
  }

  // --- Page numbers, added last across every buffered page ---
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    // Keep the footer above PDFKit's bottom auto-flow boundary. Writing at
    // height - 40 (inside the bottom margin) silently created a trailing
    // blank page after pageCount had already been calculated.
    doc.fontSize(8).fillColor("#888").text(`Page ${i + 1} of ${pageCount} — ${input.caseNumber} v${input.findingVersion}`, 50, doc.page.height - 65, {
      align: "center",
      width: doc.page.width - 100,
    });
  }

  doc.end();
  return done;
}
