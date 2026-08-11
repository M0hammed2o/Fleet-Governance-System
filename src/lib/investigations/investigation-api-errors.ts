import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/auth/api-guard";

const FORBIDDEN_ERROR_NAMES = new Set(["AuditorAccessDeniedError", "DownloadNotPermittedByGrantError"]);

const CONFLICT_ERROR_NAMES = new Set(["IdempotencyKeyConflictError"]);

// Every non-"...NotFoundError" error class the investigation repository
// layer can throw for an invalid-but-recognised request (state-machine
// violations, validation, dual-control/separation-of-duties refusals).
// Deliberately an explicit allow-list, not "any Error subtype" — an
// unrecognised error (a real bug, a Prisma error, a TypeError) must still
// fall through to apiErrorResponse()'s 500, never be silently reported as
// a 400 client error.
const BAD_REQUEST_ERROR_NAMES = new Set([
  "InvalidCaseTransitionError",
  "CaseClosureRequirementsNotMetError",
  "SeparationOfDutiesViolationError",
  "NoteAlreadyAmendedError",
  "EvidenceAlreadyEnteredInErrorError",
  "MediaAssetNotInTenantError",
  "FindingNotEditableError",
  "FindingNotSubmittableError",
  "FindingNotPendingApprovalError",
  "FindingNotAmendableError",
  "SameActorCannotApproveOwnFindingError",
  "HoldNotActiveError",
  "AuditorUserNotEligibleError",
  "GrantCaseNotInTenantError",
  "GrantAlreadyRevokedError",
  "GrantExpiryInvalidError",
  "FindingNotApprovedForReportError",
  // Thrown by uploadMediaAsset() (media-asset-repository.ts), reached via
  // uploadEvidenceToCase() — the evidence-upload route reuses the same
  // validation as api/media/upload, so it needs the same error mapping.
  "InvalidFileTypeError",
  "EmptyFileError",
  "FileTooLargeError",
  "ChecksumMismatchError",
  "MediaProcessingError",
]);

/**
 * Shared error->HTTP mapping for every route under api/investigations and
 * api/external-auditor — the investigation repository layer throws many
 * small, precisely-named error classes (see investigation-case-repository.ts
 * etc.) rather than one generic error, so routes map by name against two
 * explicit allow-lists instead of repeating a long instanceof chain in
 * every file. Falls back to apiErrorResponse() (which already handles
 * ApiError/ForbiddenError/500) for anything not recognised here.
 */
export function investigationErrorResponse(err: unknown): NextResponse {
  if (err instanceof Error) {
    if (err.name.endsWith("NotFoundError")) return NextResponse.json({ error: err.message }, { status: 404 });
    if (FORBIDDEN_ERROR_NAMES.has(err.name)) return NextResponse.json({ error: err.message }, { status: 403 });
    if (CONFLICT_ERROR_NAMES.has(err.name)) return NextResponse.json({ error: err.message }, { status: 409 });
    if (BAD_REQUEST_ERROR_NAMES.has(err.name)) return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return apiErrorResponse(err);
}
