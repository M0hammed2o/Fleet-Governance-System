/**
 * Convention, not magic: every repository function for a tenant-owned model
 * must accept a tenantId and merge it into the Prisma `where` clause via this
 * helper, so a reviewer can grep for `tenantWhere(` to confirm no query
 * skipped tenant scoping. See ARCHITECTURE.md "tenant-isolation strategy".
 */
export function tenantWhere<Where extends Record<string, unknown>>(
  tenantId: string,
  where: Where = {} as Where,
): Where & { tenantId: string } {
  return { ...where, tenantId };
}
