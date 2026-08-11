import { NextResponse } from "next/server";
import { checkDatabaseReadiness } from "@/lib/operations/readiness";
import { inspectRuntimeConfiguration } from "@/lib/config/runtime-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const [database, configuration] = await Promise.all([
    checkDatabaseReadiness(),
    Promise.resolve(inspectRuntimeConfiguration()),
  ]);
  const ready = database === "READY" && configuration.valid;
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      checks: {
        database: database === "READY" ? "ok" : "unavailable",
        configuration: configuration.valid ? "ok" : "invalid",
      },
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
