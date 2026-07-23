import { describe, it, expect } from "vitest";
import { assertSafeToSeed } from "@/lib/db/seed-guard";

const LOCAL_URL = "postgresql://user:pass@localhost:5432/db";
const LOOPBACK_URL = "postgresql://user:pass@127.0.0.1:5432/db";
const PROD_LOOKING_URL = "postgresql://user:pass@prod-db.example.com:5432/db";

describe("assertSafeToSeed", () => {
  it("allows localhost with no special env", () => {
    expect(() => assertSafeToSeed(LOCAL_URL, {})).not.toThrow();
  });

  it("allows 127.0.0.1", () => {
    expect(() => assertSafeToSeed(LOOPBACK_URL, {})).not.toThrow();
  });

  it("refuses when NODE_ENV=production, even against localhost", () => {
    expect(() => assertSafeToSeed(LOCAL_URL, { NODE_ENV: "production" })).toThrow(/production/i);
  });

  it("refuses a non-localhost host by default", () => {
    expect(() => assertSafeToSeed(PROD_LOOKING_URL, {})).toThrow(/not localhost/i);
  });

  it("allows a non-localhost host only with the explicit override", () => {
    expect(() => assertSafeToSeed(PROD_LOOKING_URL, { ALLOW_SEED_NON_LOCALHOST: "true" })).not.toThrow();
  });

  it("the production check wins even if the override flag is also set", () => {
    expect(() =>
      assertSafeToSeed(PROD_LOOKING_URL, { NODE_ENV: "production", ALLOW_SEED_NON_LOCALHOST: "true" }),
    ).toThrow(/production/i);
  });
});
