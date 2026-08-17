import "server-only";
import { demoSelfServiceEnabled } from "@/lib/config/runtime-config-core";

export function isDemoRegistrationEnabled(): boolean {
  return demoSelfServiceEnabled(process.env);
}
