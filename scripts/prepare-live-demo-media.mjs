/**
 * Idempotently adds three generated, clearly synthetic demo assets through
 * the public application APIs, then verifies private R2 retrieval. No real
 * face, person, licence, vehicle or location data is used.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import sharp from "sharp";

const CONFIRMATION = "UPLOAD_GENBRIDGE_SYNTHETIC_DEMO_MEDIA";
const baseUrl = (process.env.LIVE_DEMO_BASE_URL || "https://genbridge-fleet-governance.onrender.com").replace(/\/$/, "");
const credentialPath = path.resolve(process.env.LIVE_DEMO_CREDENTIAL_FILE || ".data/private/demo-login-details.txt");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function credential() {
  const password = fs.readFileSync(credentialPath, "utf8").match(/^Password:\s*(.+)$/m)?.[1]?.trim();
  if (!password) throw new Error("The ignored live-demo credential file is unavailable.");
  return password;
}

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}; no live-demo media change was assumed successful.`);
  return { response, body };
}

async function generatedIllustration(kind) {
  const title = kind === "driver" ? "SYNTHETIC DRIVER PROFILE" : "SYNTHETIC DEMO VEHICLE";
  const art = kind === "driver"
    ? '<circle cx="400" cy="260" r="105" fill="#67e8f9"/><path d="M180 650c25-170 130-255 220-255s195 85 220 255" fill="#67e8f9"/>'
    : '<rect x="130" y="300" width="540" height="210" rx="35" fill="#67e8f9"/><rect x="455" y="230" width="155" height="120" rx="20" fill="#a5f3fc"/><circle cx="250" cy="535" r="58" fill="#0f172a"/><circle cx="560" cy="535" r="58" fill="#0f172a"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#0f172a"/>${art}<text x="400" y="735" fill="white" text-anchor="middle" font-family="Arial" font-size="34" font-weight="700">${title}</text><text x="400" y="775" fill="#fbbf24" text-anchor="middle" font-family="Arial" font-size="22">NOT A REAL PERSON OR ASSET</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function generatedDocument() {
  const document = new PDFDocument({ size: "A4", info: { Title: "Synthetic Demonstration Licence", Author: "Genbridge synthetic fixture" } });
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));
  const completed = new Promise((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  document.fontSize(22).text("SYNTHETIC DEMONSTRATION DOCUMENT", { align: "center" });
  document.moveDown().fontSize(15).text("NOT A REAL DRIVING LICENCE", { align: "center" });
  document.moveDown(2).fontSize(11).text("Fictitious record: Demo Driver — Thabo Nkosi");
  document.text("Reference: DEMO-LIC-0001");
  document.text("Purpose: private R2 upload and retrieval rehearsal only.");
  document.text("Contains no real person, licence, signature, photograph or biometric material.");
  document.end();
  return completed;
}

async function upload(cookie, { ownerType, ownerId, category, name, type, bytes }) {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type }));
  form.set("ownerType", ownerType);
  form.set("ownerId", ownerId);
  form.set("category", category);
  form.set("idempotencyKey", crypto.randomUUID());
  const { body } = await requestJson("/api/media/upload", { method: "POST", headers: { Cookie: cookie }, body: form });
  return body.mediaAsset.id;
}

async function verifyPrivateAsset(cookie, mediaAssetId) {
  const unauthorised = await fetch(`${baseUrl}/api/media/${mediaAssetId}`);
  assert(unauthorised.status === 401, "Media metadata was accessible without an authenticated session.");
  const { body } = await requestJson(`/api/media/${mediaAssetId}`, { headers: { Cookie: cookie } });
  assert(typeof body.url === "string", "Authorised media retrieval did not return a signed URL.");
  const signed = new URL(body.url, baseUrl);
  assert(signed.search.length > 10, "Media retrieval URL is not time-limited/signed.");
  const retrieval = await fetch(signed);
  assert(retrieval.ok && (await retrieval.arrayBuffer()).byteLength > 100, "Authorised signed media retrieval failed.");
  const unsigned = new URL(signed);
  unsigned.search = "";
  const publicAttempt = await fetch(unsigned);
  assert(!publicAttempt.ok, "The R2 object was retrievable without its signature; bucket/object privacy is not intact.");
}

async function main() {
  assert(process.env.LIVE_DEMO_MEDIA_CONFIRMATION === CONFIRMATION, `Refusing to upload synthetic demo media without LIVE_DEMO_MEDIA_CONFIRMATION=${CONFIRMATION}.`);
  const login = await requestJson("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantSlug: "genbridge-demo-logistics", email: "demo.admin@genbridge.co.za", password: credential() }),
  });
  const cookie = login.response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  assert(cookie, "Live demo login did not create a session cookie.");

  const driver = (await requestJson("/api/drivers/live-demo-driver-1", { headers: { Cookie: cookie } })).body;
  const vehicle = (await requestJson("/api/vehicles/live-demo-vehicle-1", { headers: { Cookie: cookie } })).body;
  const driverDocument = driver.documents.find((item) => item.documentType === "DRIVER_LICENCE");
  assert(driver.driver && vehicle.vehicle && driverDocument, "Fixed synthetic master records are incomplete; media was not prepared.");

  let driverImageId = driver.driver.portraitMediaAssetId;
  if (!driverImageId) {
    driverImageId = await upload(cookie, { ownerType: "DRIVER_PORTRAIT", ownerId: driver.driver.id, category: "DRIVER_PORTRAIT", name: "synthetic-driver-profile.png", type: "image/png", bytes: await generatedIllustration("driver") });
    await requestJson(`/api/drivers/${driver.driver.id}`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ portraitMediaAssetId: driverImageId }) });
  }

  let vehicleImageId = vehicle.vehicle.imageMediaAssetId;
  if (!vehicleImageId) {
    vehicleImageId = await upload(cookie, { ownerType: "VEHICLE_IMAGE", ownerId: vehicle.vehicle.id, category: "VEHICLE_INSPECTION_PHOTO", name: "synthetic-demo-vehicle.png", type: "image/png", bytes: await generatedIllustration("vehicle") });
    await requestJson(`/api/vehicles/${vehicle.vehicle.id}`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ imageMediaAssetId: vehicleImageId }) });
  }

  let documentId = driverDocument.attachmentMediaAssetId;
  if (!documentId) {
    documentId = await upload(cookie, { ownerType: "COMPLIANCE_DOCUMENT", ownerId: driverDocument.id, category: "OTHER_DOCUMENT", name: "synthetic-driving-licence.pdf", type: "application/pdf", bytes: await generatedDocument() });
    await requestJson(`/api/compliance-documents/${driverDocument.id}/attachment`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ attachmentMediaAssetId: documentId }) });
  }

  for (const mediaAssetId of [driverImageId, vehicleImageId, documentId]) await verifyPrivateAsset(cookie, mediaAssetId);

  const deceptive = new FormData();
  deceptive.set("file", new File([Buffer.from("MZ synthetic executable sentinel")], "deceptive.png", { type: "image/png" }));
  deceptive.set("ownerType", "DRIVER_PORTRAIT"); deceptive.set("ownerId", driver.driver.id); deceptive.set("category", "DRIVER_PORTRAIT"); deceptive.set("idempotencyKey", crypto.randomUUID());
  const rejected = await fetch(`${baseUrl}/api/media/upload`, { method: "POST", headers: { Cookie: cookie }, body: deceptive });
  assert(rejected.status === 400, "A deceptive image upload was not rejected safely.");

  console.log(JSON.stringify({ status: "PASS", assetsVerified: 3, unauthorisedMetadataDenied: true, unsignedObjectDenied: true, deceptiveUploadRejected: true, realPersonOrAssetDataUsed: false }));
}

main().catch((error) => {
  console.error(`[live-demo-media] FAIL: ${error instanceof Error ? error.message : "Unknown verification failure."}`);
  process.exit(1);
});
