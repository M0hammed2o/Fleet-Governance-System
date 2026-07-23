import bcrypt from "bcryptjs";

// Cost factor 12 balances brute-force resistance against login latency; revisit
// if login p95 latency becomes a problem (see SECURITY_AND_POPIA.md).
const BCRYPT_COST_FACTOR = 12;

export function hashPassword(plainTextPassword: string): Promise<string> {
  return bcrypt.hash(plainTextPassword, BCRYPT_COST_FACTOR);
}

export function verifyPassword(plainTextPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainTextPassword, passwordHash);
}
