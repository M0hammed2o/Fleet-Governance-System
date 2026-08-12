export interface MobileRuntimeConfig {
  apiBaseUrl: string;
  appEnv: "local" | "development" | "staging" | "production";
  syntheticDevelopment: boolean;
}

export function resolveMobileRuntimeConfig(
  env: Record<string, string | undefined> = import.meta.env,
): MobileRuntimeConfig {
  const appEnv = (env.VITE_APP_ENV ?? "local") as MobileRuntimeConfig["appEnv"];
  const apiBaseUrl =
    env.VITE_API_BASE_URL ??
    (appEnv === "local" ? "http://127.0.0.1:3000" : "");
  if (!apiBaseUrl)
    throw new Error("VITE_API_BASE_URL is required outside local development.");
  const parsed = new URL(apiBaseUrl);
  const isLocalHttp =
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "10.0.2.2"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLocalHttp)
    throw new Error(
      "The mobile API URL must use HTTPS outside an approved local host.",
    );
  if (appEnv === "production" && isLocalHttp)
    throw new Error(
      "Production mobile authentication cannot target a local or synthetic backend.",
    );
  return {
    apiBaseUrl,
    appEnv,
    syntheticDevelopment: appEnv === "local" || appEnv === "development",
  };
}
