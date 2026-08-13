import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const requireText = (source, value, message) => {
  if (!source.includes(value)) throw new Error(message);
};

const manifest = read("apps/mobile/android/app/src/main/AndroidManifest.xml");
const debugManifest = read(
  "apps/mobile/android/app/src/debug/AndroidManifest.xml",
);
const releaseManifest = read(
  "apps/mobile/android/app/src/release/AndroidManifest.xml",
);
const capacitor = read("apps/mobile/capacitor.config.ts");
const filePaths = read(
  "apps/mobile/android/app/src/main/res/xml/file_paths.xml",
);

for (const [value, message] of [
  ['android:scheme="genbridgefleet"', "Deep-link scheme is missing."],
  ['android:host="open"', "Deep-link host is missing."],
  ['android:allowBackup="false"', "Android backup must be disabled."],
  [
    'android:usesCleartextTraffic="false"',
    "Main cleartext traffic must be disabled.",
  ],
  ["android.permission.INTERNET", "Internet permission is required."],
  [
    "android.permission.CAMERA",
    "Camera permission is required for evidence capture.",
  ],
])
  requireText(manifest, value, message);

for (const forbidden of [
  "ACCESS_FINE_LOCATION",
  "ACCESS_COARSE_LOCATION",
  "RECORD_AUDIO",
  "READ_EXTERNAL_STORAGE",
  "WRITE_EXTERNAL_STORAGE",
  "MANAGE_EXTERNAL_STORAGE",
]) {
  if (manifest.includes(forbidden))
    throw new Error(`Forbidden Android permission found: ${forbidden}`);
}

requireText(
  debugManifest,
  'android:usesCleartextTraffic="true"',
  "Debug local API traffic override is missing.",
);
requireText(
  releaseManifest,
  'android:debuggable="false"',
  "Release debuggability must be disabled.",
);
requireText(
  releaseManifest,
  'android:usesCleartextTraffic="false"',
  "Release cleartext traffic must be disabled.",
);
requireText(
  capacitor,
  'LOCAL_ANDROID_APP_ID = "za.co.genbridge.fleet"',
  "Authorized local application ID is missing.",
);
requireText(
  capacitor,
  'ANDROID_DEEP_LINK_SCHEME = "genbridgefleet"',
  "Capacitor deep-link identity is missing.",
);
if (filePaths.includes("<external-path"))
  throw new Error(
    "The FileProvider must not expose the external storage root.",
  );

console.log(
  "Android native validation passed: provisional local identity, constrained deep link, minimal permissions, release fail-closed controls, and scoped FileProvider.",
);
