import type { CapacitorConfig } from "@capacitor/cli";

export const LOCAL_ANDROID_APP_ID = "za.co.genbridge.fleet";
export const ANDROID_DEEP_LINK_SCHEME = "genbridgefleet";

export function createCapacitorConfig(
  env: Record<string, string | undefined> = process.env,
): CapacitorConfig {
  const nativeEnvironment = env.MOBILE_NATIVE_ENV ?? "local";
  const isLocalNativeBuild = ["local", "development"].includes(
    nativeEnvironment,
  );
  const appId =
    env.MOBILE_APP_ID ??
    (isLocalNativeBuild ? LOCAL_ANDROID_APP_ID : undefined);

  if (!appId) {
    throw new Error(
      "MOBILE_APP_ID is MANUAL_CONFIRMATION_REQUIRED outside local Android development.",
    );
  }
  if (isLocalNativeBuild && appId !== LOCAL_ANDROID_APP_ID) {
    throw new Error(
      `Local Android builds are authorized only for ${LOCAL_ANDROID_APP_ID}.`,
    );
  }
  if (!isLocalNativeBuild && appId === LOCAL_ANDROID_APP_ID) {
    throw new Error(
      "The provisional Android application ID is authorized for local development only.",
    );
  }

  return {
    appId,
    appName: "Genbridge Fleet Governance",
    webDir: "dist",
    loggingBehavior: isLocalNativeBuild ? "debug" : "none",
    server: { androidScheme: "https" },
    android: {
      allowMixedContent: isLocalNativeBuild,
      // Capacitor enables WebView inspection for debug builds without making it
      // an unconditional production setting.
      webContentsDebuggingEnabled: false,
    },
  };
}

export default createCapacitorConfig();
