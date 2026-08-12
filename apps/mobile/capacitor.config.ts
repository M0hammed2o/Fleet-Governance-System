import type { CapacitorConfig } from "@capacitor/cli";

const appId = process.env.MOBILE_APP_ID;
if (!appId) throw new Error("MOBILE_APP_ID is MANUAL_CONFIRMATION_REQUIRED before generating native projects.");
const config: CapacitorConfig = { appId, appName: "Genbridge Fleet Governance", webDir: "dist", server: { androidScheme: "https" } };
export default config;
