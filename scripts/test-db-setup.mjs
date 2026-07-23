// Applies pending Prisma migrations to the test database before the test
// suite runs. Wired as the npm "pretest" hook — see package.json.
import { config } from "dotenv";
import { execSync } from "node:child_process";

config({ path: ".env.test" });

execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: process.env,
});
