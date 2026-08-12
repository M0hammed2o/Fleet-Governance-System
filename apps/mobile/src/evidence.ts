export const MOBILE_EVIDENCE_MAX_BYTES = 25 * 1024 * 1024;
export const MOBILE_EVIDENCE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export function validateEvidenceFile(
  file: Pick<File, "name" | "size" | "type">,
): string | null {
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > MOBILE_EVIDENCE_MAX_BYTES)
    return "Evidence must be 25 MB or smaller.";
  if (!MOBILE_EVIDENCE_TYPES.has(file.type))
    return "Choose a JPEG, PNG, WebP, or PDF file.";
  if (/[\r\n\0]/.test(file.name))
    return "The filename contains unsupported characters.";
  return null;
}
