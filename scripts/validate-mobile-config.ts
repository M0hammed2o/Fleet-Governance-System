import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = ["apps/mobile/package.json", "apps/mobile/capacitor.config.ts", "apps/mobile/src/secure-session.ts", "MOBILE_APPLICATION_ARCHITECTURE.md"];
for (const file of required) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing mobile configuration: ${file}`);
const capacitor = fs.readFileSync(path.join(root, "apps/mobile/capacitor.config.ts"), "utf8");
if (!capacitor.includes("MOBILE_APP_ID") || !capacitor.includes("MANUAL_CONFIRMATION_REQUIRED")) throw new Error("Native application identifier must remain explicit and fail-closed.");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "apps/mobile/package.json"), "utf8")) as { dependencies: Record<string, string> };
for (const forbidden of ["expo", "react-native", "@react-native-async-storage/async-storage"]) if (packageJson.dependencies[forbidden]) throw new Error(`Forbidden unresolved mobile dependency: ${forbidden}`);
if (!packageJson.dependencies["@aparajita/capacitor-secure-storage"]) throw new Error("Native secure storage dependency is required.");
console.log("Mobile configuration validation passed: identifiers fail closed, native secure storage configured, Expo/React Native vulnerable graph absent.");
