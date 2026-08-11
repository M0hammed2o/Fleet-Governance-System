import "server-only";
import PDFDocument from "pdfkit";

type DashboardForReport = Awaited<ReturnType<typeof import("@/lib/repositories/analytics-dashboard-repository").getGovernanceAnalyticsDashboard>>;

function label(value: string) {
  return value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/(^|\s)\S/g, (match) => match.toUpperCase());
}

export async function renderGovernanceAnalyticsPdf(dashboard: DashboardForReport, generatedBy: string, generatedAt = new Date()): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, compress: false, info: { Title: `Governance analytics — ${dashboard.tenant.name}`, Author: dashboard.tenant.name } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const pageBottom = () => doc.page.height - 75;
    const ensureSpace = (height = 80) => {
      if (doc.y + height > pageBottom()) doc.addPage();
    };
    const heading = (text: string) => {
      ensureSpace(45);
      doc.moveDown(0.6).font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(text);
      doc.moveDown(0.35);
    };
    const line = (name: string, value: unknown) => {
      ensureSpace(22);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#334155").text(`${name}: `, { continued: true });
      doc.font("Helvetica").fillColor("#0f172a").text(value == null ? "Not available" : String(value));
    };

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a").text("Governance Analytics Report");
    doc.moveDown(0.3).font("Helvetica").fontSize(10).fillColor("#475569").text(dashboard.tenant.name);
    doc.text(`Reporting period: ${dashboard.period.startDate} to ${dashboard.period.endDate} (${dashboard.tenant.timezone})`);
    doc.text(`Generated: ${generatedAt.toISOString()} by ${generatedBy}`);
    doc.moveDown(0.8);
    const noticeTop = doc.y;
    doc.roundedRect(50, noticeTop, doc.page.width - 100, 66, 5).fillAndStroke("#fff7ed", "#fdba74");
    doc.fillColor("#9a3412").font("Helvetica-Bold").fontSize(9).text("Human review required", 62, noticeTop + 11, { width: doc.page.width - 124 });
    doc.font("Helvetica").text("Risk indicators are deterministic prompts for authorised review. They are not findings of fraud, misconduct, dishonesty, guilt, or a basis for an automated disciplinary decision.", 62, noticeTop + 27, { width: doc.page.width - 124 });
    doc.y = noticeTop + 66;

    heading("Data quality and tracking transparency");
    line("Overall data-quality status", dashboard.dataQuality.status);
    line("Statement", dashboard.dataQuality.statement);
    line("Applied filters", Object.keys(dashboard.filters).length ? JSON.stringify(dashboard.filters) : "No optional filters applied");
    line("Tracking source labels", dashboard.tracking.sourceLabels.join(", ") || "Unavailable");
    line("Latest tracking timestamp", dashboard.tracking.latestTrackingTimestamp?.toISOString() ?? "Unavailable");
    line("Limitation", dashboard.tracking.limitation);

    heading("Executive governance summary");
    for (const [key, value] of Object.entries(dashboard.executive)) line(label(key), value instanceof Date ? value.toISOString() : value);

    heading("Operational analytics");
    const operationalEntries = Object.entries(dashboard.operational).filter(([, value]) => !Array.isArray(value));
    for (const [key, value] of operationalEntries) line(label(key), value);
    line("Inspection failures by category", dashboard.operational.inspectionFailuresByCategory.map((item) => `${label(item.category)}: ${item.count}`).join("; ") || "None");
    line("Reconciliation discrepancies by category", dashboard.operational.discrepanciesByCategory.map((item) => `${label(item.category)}: ${item.count}`).join("; ") || "None");

    heading("Explainable risk indicators");
    if (dashboard.indicators.length === 0) doc.font("Helvetica").fontSize(9).fillColor("#475569").text("No persisted indicators matched the selected reporting period and filters.");
    for (const indicator of dashboard.indicators) {
      ensureSpace(90);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text(`${indicator.title} — ${indicator.severity}`);
      doc.font("Helvetica").fontSize(9).fillColor("#334155").text(`Subject: ${indicator.subjectType} ${indicator.subjectLabel}; occurrences: ${indicator.occurrenceCount}; status: ${indicator.status}; data quality: ${indicator.dataQuality}`);
      doc.text(indicator.explanation, { width: doc.page.width - 100 });
      doc.moveDown(0.4);
    }

    heading("Investigation analytics (aggregated)");
    line("Cases by source", JSON.stringify(dashboard.investigations.bySource));
    line("Cases by category", JSON.stringify(dashboard.investigations.byCategory));
    line("Cases by priority", JSON.stringify(dashboard.investigations.byPriority));
    line("Cases by status", JSON.stringify(dashboard.investigations.byStatus));
    line("Cases by outcome", JSON.stringify(dashboard.investigations.byOutcome));
    for (const [key, value] of Object.entries(dashboard.investigations).filter(([key, value]) => !key.startsWith("by") && key !== "confidentialityStatement" && (typeof value === "number" || value == null))) line(label(key), value);
    line("Confidentiality", dashboard.investigations.confidentialityStatement);

    const pageCount = doc.bufferedPageRange().count;
    for (let index = 0; index < pageCount; index += 1) {
      doc.switchToPage(index);
      doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(`Governance Analytics • ${dashboard.period.startDate} to ${dashboard.period.endDate} • Page ${index + 1} of ${pageCount}`, 50, doc.page.height - 65, { width: doc.page.width - 100, align: "center", lineBreak: false });
    }
    doc.end();
  });
}
