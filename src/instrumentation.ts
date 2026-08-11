export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionRuntimeConfiguration } = await import("@/lib/config/runtime-config");
  assertProductionRuntimeConfiguration();
}
