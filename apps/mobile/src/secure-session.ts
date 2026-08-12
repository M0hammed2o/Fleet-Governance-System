import { Capacitor } from "@capacitor/core";
import type { SessionTokenStore } from "@genbridge/api-client";

const TOKEN_KEY = "genbridge.mobile.session.v1";
let browserMemoryToken: string | null = null;

async function nativeStorage() {
  const secureStoragePackage = await import(
    "@aparajita/capacitor-secure-storage"
  );
  return secureStoragePackage.SecureStorage;
}

export function createSecureSessionStore(
  native = Capacitor.isNativePlatform(),
): SessionTokenStore {
  if (!native) {
    return {
      async get() {
        return browserMemoryToken;
      },
      async set(token) {
        browserMemoryToken = token;
      },
      async clear() {
        browserMemoryToken = null;
      },
    };
  }
  return {
    async get() {
      const value = await (await nativeStorage()).get(TOKEN_KEY);
      return typeof value === "string" ? value : null;
    },
    async set(token) {
      await (await nativeStorage()).set(TOKEN_KEY, token);
    },
    async clear() {
      await (await nativeStorage()).remove(TOKEN_KEY);
    },
  };
}

export function resetBrowserSessionForTests(): void {
  browserMemoryToken = null;
}
