import { requireApiSession } from "@/lib/auth/api-guard";
import { analyticsErrorResponse } from "@/lib/analytics/analytics-api-errors";
import { generateGovernanceAnalyticsCsv } from "@/lib/repositories/analytics-export-repository";
import { analyticsFiltersFromUrl } from "@/lib/validation/analytics";

export async function GET(request: Request) {
  try {
    const session = await requireApiSession();
    const result = await generateGovernanceAnalyticsCsv(session, analyticsFiltersFromUrl(request.url));
    return new Response(result.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${result.fileName}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
