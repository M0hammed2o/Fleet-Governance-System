import { describe, expect, it } from "vitest";
import { bearerTokenFromRequest } from "@/lib/auth/session";
import { authorizeDeepLink, allowedAreas } from "../apps/mobile/src/navigation-policy";
import { validateEvidenceFile, MOBILE_EVIDENCE_MAX_BYTES } from "../apps/mobile/src/evidence";
import type { MobileBootstrapResponse } from "@genbridge/shared-types";
import { allowedMobileOrigin, configuredMobileOrigins } from "@/lib/mobile/cors";
import { evaluateRequestPolicy } from "@/lib/security/request-policy";

function bootstrap(overrides: Partial<MobileBootstrapResponse["capabilities"]> = {}): MobileBootstrapResponse {
  return { principal: { userId: "user-1", name: "Synthetic User", roleName: "Role label is not authority", tenant: { id: "tenant-1", name: "Synthetic Tenant", slug: "synthetic" }, permissions: [], sessionExpiresAt: new Date(Date.now() + 60_000).toISOString() }, sites: [], capabilities: { guard: false, ownerOverview: false, approvals: false, investigations: false, confidentialInvestigations: false, ...overrides }, environment: { appEnv: "development", syntheticOnly: true, pushEnabled: false, offlineMutations: false } };
}

describe("mobile security foundation", () => {
  it("strictly parses one opaque bearer token", () => {
    expect(bearerTokenFromRequest(new Request("http://local", { headers: { Authorization: "Bearer abcdefghijklmnopqrstuvwxyz_123456" } }))).toBe("abcdefghijklmnopqrstuvwxyz_123456");
    for (const value of ["Basic abc", "Bearer short", "Bearer token one", "Bearer abc.def+unsupported"]) expect(bearerTokenFromRequest(new Request("http://local", { headers: { Authorization: value } }))).toBeNull();
  });

  it("derives navigation and deep-link access from server capabilities, never a role label", () => {
    expect(allowedAreas(bootstrap({ guard: true }))).toEqual(["guard", "notifications", "profile"]);
    expect(authorizeDeepLink("home", bootstrap())).toBe(true);
    expect(authorizeDeepLink("guard", bootstrap({ guard: true }))).toBe(true);
    expect(authorizeDeepLink("owner", bootstrap({ ownerOverview: true }))).toBe(true);
    expect(authorizeDeepLink("owner/investigations/case-1", bootstrap({ ownerOverview: true }))).toBe(false);
    expect(authorizeDeepLink("owner/investigations/case-1", bootstrap({ ownerOverview: true, investigations: true }))).toBe(true);
    expect(authorizeDeepLink("guard/events/other-tenant-id", bootstrap())).toBe(false);
  });

  it("validates evidence size, MIME type and filename before upload", () => {
    expect(validateEvidenceFile({ name: "synthetic.jpg", size: 1234, type: "image/jpeg" })).toBeNull();
    expect(validateEvidenceFile({ name: "large.jpg", size: MOBILE_EVIDENCE_MAX_BYTES + 1, type: "image/jpeg" })).toMatch(/25 MB/);
    expect(validateEvidenceFile({ name: "payload.html", size: 100, type: "text/html" })).toMatch(/JPEG/);
    expect(validateEvidenceFile({ name: "line\nbreak.jpg", size: 100, type: "image/jpeg" })).toMatch(/filename/);
  });

  it("allows mobile CORS only for an exact configured origin", () => {
    const origins = configuredMobileOrigins(
      "capacitor://localhost,https://mobile.example.test,not-a-url",
    );
    expect(allowedMobileOrigin("capacitor://localhost", origins)).toBe(
      "capacitor://localhost",
    );
    expect(
      allowedMobileOrigin("https://mobile.example.test", origins),
    ).toBe("https://mobile.example.test");
    expect(allowedMobileOrigin("https://evil.example", origins)).toBeNull();
    expect(
      evaluateRequestPolicy({
        method: "POST",
        pathname: "/api/mobile/bootstrap",
        origin: "https://mobile.example.test",
        requestOrigin: "https://api.example.test",
        secFetchSite: "cross-site",
        configuredOrigins: ["https://mobile.example.test"],
      }).allowed,
    ).toBe(true);
    expect(
      evaluateRequestPolicy({
        method: "POST",
        pathname: "/api/mobile/gate/events",
        origin: "capacitor://localhost",
        requestOrigin: "https://api.example.test",
        secFetchSite: "cross-site",
        configuredOrigins: ["capacitor://localhost"],
      }).allowed,
    ).toBe(true);
  });
});
