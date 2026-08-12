import { execFileSync } from "node:child_process";

const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" });
if (status.trim()) {
  process.stderr.write("Working tree is not clean. Commit or remove candidate changes before running the release gate.\n");
  process.exit(1);
}
process.stdout.write("Working tree is clean.\n");
