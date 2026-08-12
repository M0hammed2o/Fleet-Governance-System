import { beforeEach, describe, expect, it } from "vitest";
import { createSecureSessionStore, resetBrowserSessionForTests } from "../apps/mobile/src/secure-session";
import { clearSelectedGateId, getSelectedGateId, setSelectedGateId } from "../apps/mobile/src/gate-assignment";

describe("mobile local state boundaries", () => {
  beforeEach(() => { resetBrowserSessionForTests(); clearSelectedGateId(); });
  it("keeps browser-simulation sessions in memory and clears on sign-out", async () => {
    const store = createSecureSessionStore(false);
    expect(await store.get()).toBeNull();
    await store.set("opaque-session-token");
    expect(await store.get()).toBe("opaque-session-token");
    await store.clear();
    expect(await store.get()).toBeNull();
  });
  it("keeps gate assignment memory-only", () => { setSelectedGateId("gate-1"); expect(getSelectedGateId()).toBe("gate-1"); clearSelectedGateId(); expect(getSelectedGateId()).toBe(""); });
});
