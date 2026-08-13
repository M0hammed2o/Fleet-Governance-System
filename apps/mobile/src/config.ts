export interface MobileRuntimeConfig {
  apiBaseUrl: string;
  appEnv: "local" | "development" | "staging" | "production";
  syntheticDevelopment: boolean;
}

export function resolveMobileRuntimeConfig(
  env?: Record<string, string | undefined>,
): MobileRuntimeConfig {
  const runtimeEnv = env ?? {
    VITE_APP_ENV: Reflect.get(import.meta.env, "VITE_APP_ENV") as
      string | undefined,
    VITE_API_BASE_URL: Reflect.get(import.meta.env, "VITE_API_BASE_URL") as
      string | undefined,
  };
  const appEnv = (runtimeEnv.VITE_APP_ENV ??
    "local") as MobileRuntimeConfig["appEnv"];
  const apiBaseUrl =
    runtimeEnv.VITE_API_BASE_URL ??
    (appEnv === "local" ? "http://127.0.0.1:3000" : "");
  if (!apiBaseUrl)
    throw new Error("VITE_API_BASE_URL is required outside local development.");
  const parsed = new URL(apiBaseUrl);
  const productionLike = appEnv === "staging" || appEnv === "production";
  const isLocalHttp =
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "10.0.2.2"].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.hash)
    throw new Error(
      "The mobile API URL cannot contain credentials or a fragment.",
    );
  if (parsed.protocol !== "https:" && !isLocalHttp)
    throw new Error(
      "The mobile API URL must use HTTPS outside an approved local host.",
    );
  if (productionLike && isLocalHttp)
    throw new Error(
      "Staging and production mobile authentication cannot target a local backend.",
    );
  if (
    productionLike &&
    (parsed.hostname.endsWith(".test") ||
      parsed.hostname.endsWith(".example") ||
      parsed.hostname === "example.com" ||
      parsed.hostname === "0.0.0.0")
  )
    throw new Error(
      "Staging and production mobile authentication cannot target a placeholder host.",
    );
  return {
    apiBaseUrl,
    appEnv,
    syntheticDevelopment: appEnv === "local" || appEnv === "development",
  };
}
