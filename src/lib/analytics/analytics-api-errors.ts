import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/auth/api-guard";
import { ZodError } from "zod";

const BAD_REQUEST = new Set([
  "InvalidAnalyticsPeriodError",
  "AnalyticsRuleValidationError",
  "AnalyticsIndicatorTransitionError",
  "AnalyticsSupportingRecordError",
  "AnalyticsExportLimitError",
]);

export function analyticsErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  if (error instanceof Error) {
    if (error.name.endsWith("NotFoundError")) return NextResponse.json({ error: error.message }, { status: 404 });
    if (BAD_REQUEST.has(error.name)) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return apiErrorResponse(error);
}
