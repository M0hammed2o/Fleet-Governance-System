import "server-only";
import {
  RuntimeConfigurationError,
  validateRuntimeConfiguration,
  type RuntimeConfiguration,
  type RuntimeConfigurationValidation,
} from "@/lib/config/runtime-config-core";

export function inspectRuntimeConfiguration(): RuntimeConfigurationValidation {
  return validateRuntimeConfiguration(process.env);
}

export function getRuntimeConfiguration(): RuntimeConfiguration {
  const result = inspectRuntimeConfiguration();
  if (!result.valid || !result.config) throw new RuntimeConfigurationError(result.issues);
  return result.config;
}

export function assertProductionRuntimeConfiguration(): void {
  const result = inspectRuntimeConfiguration();
  if (result.config?.APP_ENV === "production" && !result.valid) {
    throw new RuntimeConfigurationError(result.issues);
  }
}

export function isProductionDeployment(): boolean {
  return process.env.APP_ENV === "production";
}
