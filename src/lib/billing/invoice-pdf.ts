import "server-only";
import PDFDocument from "pdfkit";
import { formatMinorUnits } from "@/lib/billing/money";

/**
 * Phase 10 (P10E) — renders an immutable invoice snapshot to PDF bytes
 * using `pdfkit` (MIT licensed, pure Node — no headless browser or native
 * binary dependency). Takes only the already-computed/stored snapshot
 * fields (never re-derives pricing/VAT from current, possibly-changed
 * configuration) so the rendered document always matches exactly what was
 * issued, even if platform/tenant pricing or the platform's own
 * registration details change later (D-035).
 */

export interface InvoicePdfSupplier {
  legalName: string;
  tradingName?: string | null;
  registrationNumber?: string | null;
  vatRegistrationNumber?: string | null;
  addressLines: string[];
  billingEmail?: string | null;
  telephone?: string | null;
  bankingInstructions?: string | null;
}

export interface InvoicePdfCustomer {
  name: string;
  registrationNumber?: string | null;
  vatNumber?: string | null;
  addressLines: string[];
  billingEmail?: string | null;
}

export interface InvoicePdfLineItem {
  description: string;
  quantity: number;
  unitPriceMinorUnits: number;
  lineTotalMinorUnits: number;
}

export interface InvoicePdfInput {
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  billingPeriodLabel?: string | null;
  currency: string;
  supplier: InvoicePdfSupplier;
  customer: InvoicePdfCustomer;
  lineItems: InvoicePdfLineItem[];
  subtotalMinorUnits: number;
  vatRateBasisPoints?: number | null;
  vatAmountMinorUnits: number;
  totalMinorUnits: number;
  customerPoReference?: string | null;
  paymentReference?: string | null;
  paymentStatusLabel: string;
  /** True only when the platform's VAT registration + rate are configured — an unconfigured platform must never be shown as issuing a VAT tax invoice (approved commercial model instruction). */
  isVatTaxInvoice: boolean;
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const fmt = (minorUnits: number) => formatMinorUnits(minorUnits, input.currency);

  doc.fontSize(20).text(input.isVatTaxInvoice ? "TAX INVOICE" : "INVOICE", { align: "right" });
  doc.fontSize(10).fillColor("#555").text(input.invoiceNumber, { align: "right" });
  if (!input.isVatTaxInvoice) {
    doc.fontSize(8).fillColor("#888").text("VAT was not charged on this invoice.", { align: "right" });
  }
  doc.moveDown(1.5);

  doc.fillColor("#000").fontSize(12).text(input.supplier.tradingName || input.supplier.legalName);
  doc.fontSize(9).fillColor("#333");
  if (input.supplier.legalName !== (input.supplier.tradingName || input.supplier.legalName)) doc.text(input.supplier.legalName);
  for (const line of input.supplier.addressLines) doc.text(line);
  if (input.supplier.registrationNumber) doc.text(`Registration: ${input.supplier.registrationNumber}`);
  if (input.supplier.vatRegistrationNumber) doc.text(`VAT No: ${input.supplier.vatRegistrationNumber}`);
  if (input.supplier.billingEmail) doc.text(input.supplier.billingEmail);
  if (input.supplier.telephone) doc.text(input.supplier.telephone);

  doc.moveDown(1);
  doc.fillColor("#000").fontSize(11).text("Bill to:");
  doc.fontSize(9).fillColor("#333").text(input.customer.name);
  for (const line of input.customer.addressLines) doc.text(line);
  if (input.customer.registrationNumber) doc.text(`Registration: ${input.customer.registrationNumber}`);
  if (input.customer.vatNumber) doc.text(`VAT No: ${input.customer.vatNumber}`);
  if (input.customer.billingEmail) doc.text(input.customer.billingEmail);

  doc.moveDown(1);
  doc.fillColor("#000").fontSize(9);
  doc.text(`Issue date: ${input.issueDate.toISOString().slice(0, 10)}`);
  doc.text(`Due date: ${input.dueDate.toISOString().slice(0, 10)}`);
  if (input.billingPeriodLabel) doc.text(`Billing period: ${input.billingPeriodLabel}`);
  if (input.customerPoReference) doc.text(`Customer reference / PO: ${input.customerPoReference}`);
  doc.text(`Payment status: ${input.paymentStatusLabel}`);
  if (input.paymentReference) doc.text(`Payment reference: ${input.paymentReference}`);

  doc.moveDown(1.5);
  const tableTop = doc.y;
  doc.fontSize(9).fillColor("#000");
  doc.text("Description", 50, tableTop, { width: 260 });
  doc.text("Qty", 320, tableTop, { width: 50, align: "right" });
  doc.text("Unit price", 380, tableTop, { width: 80, align: "right" });
  doc.text("Amount", 470, tableTop, { width: 80, align: "right" });
  doc.moveTo(50, tableTop + 14).lineTo(550, tableTop + 14).strokeColor("#ccc").stroke();

  let y = tableTop + 20;
  for (const item of input.lineItems) {
    doc.fontSize(9).fillColor("#333");
    doc.text(item.description, 50, y, { width: 260 });
    doc.text(String(item.quantity), 320, y, { width: 50, align: "right" });
    doc.text(fmt(item.unitPriceMinorUnits), 380, y, { width: 80, align: "right" });
    doc.text(fmt(item.lineTotalMinorUnits), 470, y, { width: 80, align: "right" });
    y += 18;
  }

  y += 8;
  doc.moveTo(320, y).lineTo(550, y).strokeColor("#ccc").stroke();
  y += 8;
  doc.fontSize(9).fillColor("#000");
  doc.text("Subtotal", 380, y, { width: 80, align: "right" });
  doc.text(fmt(input.subtotalMinorUnits), 470, y, { width: 80, align: "right" });
  y += 16;

  if (input.isVatTaxInvoice && input.vatRateBasisPoints != null) {
    doc.text(`VAT (${(input.vatRateBasisPoints / 100).toFixed(2)}%)`, 380, y, { width: 80, align: "right" });
    doc.text(fmt(input.vatAmountMinorUnits), 470, y, { width: 80, align: "right" });
    y += 16;
  } else {
    doc.fontSize(8).fillColor("#888").text("VAT not charged", 380, y, { width: 80, align: "right" });
    y += 16;
  }

  doc.fontSize(11).fillColor("#000").font("Helvetica-Bold");
  doc.text("Total", 380, y, { width: 80, align: "right" });
  doc.text(fmt(input.totalMinorUnits), 470, y, { width: 80, align: "right" });
  doc.font("Helvetica");

  if (input.supplier.bankingInstructions) {
    doc.moveDown(3);
    doc.fontSize(9).fillColor("#000").text("Payment instructions", { underline: true });
    doc.fontSize(8).fillColor("#333").text(input.supplier.bankingInstructions);
  }

  doc.end();
  return done;
}
