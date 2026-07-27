import { afterAll } from "vitest";
import { cleanupCreatedTenants } from "../helpers/fixtures";

/**
 * Phase 8E-007 — registered as a Vitest `setupFile`, so it runs once per
 * test *file* (Vitest gives each file its own module instance, the same
 * isolation that already made a per-file `unique()` counter safe — see
 * fixtures.ts) without needing to add an `afterAll` to all ~35 test files
 * individually. Deletes every tenant that file's tests created via
 * `createTenant()`, cascading through everything that tenant owns — see
 * fixtures.ts's own comment for why this is safe (disposable test database
 * only, `onDelete: Cascade` everywhere, never touches dev/production).
 */
console.error("[global-cleanup] setup file loaded");

afterAll(async () => {
  await cleanupCreatedTenants();
});
