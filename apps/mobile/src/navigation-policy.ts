import type {
  MobileBootstrapResponse,
  PermissionKey,
} from "@genbridge/shared-types";

export type MobileArea = "guard" | "owner" | "notifications" | "profile";

export function hasPermission(
  permissions: PermissionKey[],
  key: PermissionKey,
): boolean {
  return permissions.includes(key);
}

export function allowedAreas(bootstrap: MobileBootstrapResponse): MobileArea[] {
  const areas: MobileArea[] = [];
  if (bootstrap.capabilities.guard) areas.push("guard");
  if (bootstrap.capabilities.ownerOverview) areas.push("owner");
  areas.push("notifications", "profile");
  return areas;
}

export function authorizeDeepLink(
  path: string,
  bootstrap: MobileBootstrapResponse,
): boolean {
  const normalized = path.split("?")[0].replace(/^\//, "");
  if (!normalized || normalized === "login") return true;
  if (normalized.startsWith("guard/")) return bootstrap.capabilities.guard;
  if (normalized.startsWith("owner/investigations/"))
    return bootstrap.capabilities.investigations;
  if (normalized.startsWith("owner/"))
    return bootstrap.capabilities.ownerOverview;
  return normalized === "notifications" || normalized === "profile";
}
