import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const androidRoot = path.join(root, "apps", "mobile", "android");
const wrapper = path.join(
  androidRoot,
  process.platform === "win32" ? "gradlew.bat" : "gradlew",
);
const tasks = process.argv.slice(2);

if (tasks.length === 0)
  throw new Error("At least one Gradle task is required.");
if (tasks.some((task) => !/^[A-Za-z0-9:_-]+$/.test(task)))
  throw new Error(
    "Gradle task names may contain only letters, digits, :, _, and -.",
  );

const command =
  process.platform === "win32"
    ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")
    : wrapper;
const args =
  process.platform === "win32"
    ? ["/d", "/s", "/c", `call .\\gradlew.bat --no-daemon ${tasks.join(" ")}`]
    : ["--no-daemon", ...tasks];

const result = spawnSync(command, args, {
  cwd: androidRoot,
  env: {
    ...process.env,
    ANDROID_HOME:
      process.env.ANDROID_HOME ??
      path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk"),
  },
  encoding: "utf8",
  stdio: "inherit",
  shell: false,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
