import crypto from "node:crypto";

// Short, human-typeable code for the gate-facing lookup (build brief 7.5's
// "QR/reference code" search field) — not a security token, just needs to be
// short and hard to fat-finger into a collision. Excludes visually ambiguous
// characters (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateMovementReferenceCode(): string {
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `MV-${code}`;
}
