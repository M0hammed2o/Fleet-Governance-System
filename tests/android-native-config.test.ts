import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createCapacitorConfig,
  LOCAL_ANDROID_APP_ID,
} from "../apps/mobile/capacitor.config";
import { resolveMobileRuntimeConfig } from "../apps/mobile/src/config";
import { routeFromNativeUrl } from "../apps/mobile/src/router";

describe("Android native configuration", () => {
  it("uses the authorized provisional identity only for local development", () => {
    const local = createCapacitorConfig({ MOBILE_NATIVE_ENV: "local" });
    expect(local.appId).toBe(LOCAL_ANDROID_APP_ID);
    expect(local.android?.allowMixedContent).toBe(true);
    expect(local.android?.webContentsDebuggingEnabled).toBe(false);
    expect(() =>
      createCapacitorConfig({
        MOBILE_NATIVE_ENV: "production",
        MOBILE_APP_ID: LOCAL_ANDROID_APP_ID,
      }),
    ).toThrow(/local development only/);
    expect(() =>
      createCapacitorConfig({ MOBILE_NATIVE_ENV: "production" }),
    ).toThrow(/MANUAL_CONFIRMATION_REQUIRED/);
    expect(
      createCapacitorConfig({
        MOBILE_NATIVE_ENV: "production",
        MOBILE_APP_ID: "za.co.genbridge.confirmed",
      }).android?.allowMixedContent,
    ).toBe(false);
  });

  it("accepts only the constrained custom deep-link origin", () => {
    expect(routeFromNativeUrl("genbridgefleet://open/guard/events/1")).toBe(
      "guard/events/1",
    );
    expect(routeFromNativeUrl("genbridgefleet://open/owner?tab=open")).toBe(
      "owner?tab=open",
    );
    for (const value of [
      "https://open/guard",
      "genbridgefleet://evil/guard",
      "genbridgefleet://open",
      "genbridgefleet://user@open/guard",
      "not a url",
    ])
      expect(routeFromNativeUrl(value)).toBeNull();
  });

  it("rejects insecure and placeholder staging or production API targets", () => {
    expect(
      resolveMobileRuntimeConfig({
        VITE_APP_ENV: "local",
        VITE_API_BASE_URL: "http://10.0.2.2:3000",
      }).apiBaseUrl,
    ).toBe("http://10.0.2.2:3000");
    for (const apiBaseUrl of [
      "http://127.0.0.1:3000",
      "https://api.example.test",
      "https://example.com",
    ])
      expect(() =>
        resolveMobileRuntimeConfig({
          VITE_APP_ENV: "production",
          VITE_API_BASE_URL: apiBaseUrl,
        }),
      ).toThrow();
    expect(
      resolveMobileRuntimeConfig({
        VITE_APP_ENV: "production",
        VITE_API_BASE_URL: "https://api.genbridge.co.za",
      }).apiBaseUrl,
    ).toBe("https://api.genbridge.co.za");
  });

  it("keeps Android permissions and release network controls fail closed", () => {
    const manifest = fs.readFileSync(
      "apps/mobile/android/app/src/main/AndroidManifest.xml",
      "utf8",
    );
    const release = fs.readFileSync(
      "apps/mobile/android/app/src/release/AndroidManifest.xml",
      "utf8",
    );
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:scheme="genbridgefleet"');
    expect(manifest).not.toMatch(/ACCESS_(FINE|COARSE)_LOCATION|RECORD_AUDIO/);
    expect(release).toContain('android:debuggable="false"');
    expect(release).toContain('android:usesCleartextTraffic="false"');
  });
});
