import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function deployedCommit(): string | null {
  const candidate = process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT;
  return candidate && /^[a-f0-9]{40}$/i.test(candidate) ? candidate.toLowerCase() : null;
}

/** Safe deployment identity for release verification; never exposes configuration. */
export function GET() {
  return NextResponse.json(
    { commit: deployedCommit() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
