import { describe, expect, it } from "vitest";
import {
  LIVE_DEMO_CREDENTIAL_ROTATION_CONFIRMATION_VALUE,
  assertLiveDemoCredentialRotationConfirmed,
} from "@/lib/live-demo/live-demo-safety";

describe("live synthetic demo credential rotation safety", () => {
  it("fails closed unless the dedicated confirmation value is exact", () => {
    expect(() => assertLiveDemoCredentialRotationConfirmed({})).toThrow(/refusing to rotate/i);
    expect(() => assertLiveDemoCredentialRotationConfirmed({ LIVE_SYNTHETIC_DEMO_CREDENTIAL_ROTATION_CONFIRMATION: "yes" })).toThrow(/refusing to rotate/i);
  });

  it("accepts only the documented synthetic-demo rotation confirmation", () => {
    expect(() => assertLiveDemoCredentialRotationConfirmed({
      LIVE_SYNTHETIC_DEMO_CREDENTIAL_ROTATION_CONFIRMATION: LIVE_DEMO_CREDENTIAL_ROTATION_CONFIRMATION_VALUE,
    })).not.toThrow();
  });
});
