import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { executeMobileMutation } from "@/lib/mobile/idempotency";
import { createRole, createTenant, createUser } from "./helpers/fixtures";

describe("mobile mutation idempotency", () => {
  let tenantId = ""; let userId = ""; let roleId = "";
  beforeAll(async () => { const tenant = await createTenant("Mobile idempotency"); const role = await createRole(tenant.id, "Mobile actor"); const user = await createUser({ tenantId: tenant.id, roleId: role.id, email: `mobile-${tenant.id}@example.test` }); tenantId = tenant.id; userId = user.id; roleId = role.id; });
  it("returns an exact completed result on duplicate retry and rejects key reuse", async () => {
    const session = { sessionId: "session-mobile", tenantId, userId, roleId, roleName: "Company Administrator", userStatus: "ACTIVE", tenantStatus: "ACTIVE" };
    let calls = 0;
    const first = await executeMobileMutation({ session, key: "mobile-test-0001", operation: "gate.clear", body: { id: "event-1" }, run: async () => { calls++; return { ok: true, serverSequence: 1 }; } });
    const replay = await executeMobileMutation({ session, key: "mobile-test-0001", operation: "gate.clear", body: { id: "event-1" }, run: async () => { calls++; return { ok: true, serverSequence: 2 }; } });
    expect(first.replayed).toBe(false); expect(replay).toEqual({ replayed: true, value: { ok: true, serverSequence: 1 } }); expect(calls).toBe(1);
    await expect(executeMobileMutation({ session, key: "mobile-test-0001", operation: "gate.deny", body: { id: "event-1" }, run: async () => ({ ok: false }) })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.mobileMutationReceipt.count({ where: { tenantId } })).toBe(1);
  });
});
