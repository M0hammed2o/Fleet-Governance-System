import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { uploadEvidenceToCase } from "@/lib/repositories/investigation-evidence-repository";

// Needs real filesystem access (LocalFilesystemStorageProvider), same as api/media/upload — Node runtime, not edge.
export const runtime = "nodejs";

/** Uploads a new evidence file directly to the case (P11F) — distinct from POST .../evidence, which links an already-existing MediaAsset. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await params;

    const form = await request.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Expected multipart/form-data with a file field");

    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "A file is required");

    const description = form.get("description");
    if (typeof description !== "string" || description.trim().length === 0) throw new ApiError(400, "A description is required");

    const idempotencyKey = form.get("idempotencyKey");
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) throw new ApiError(400, "An idempotencyKey is required");

    const relevance = form.get("relevance");
    const data = Buffer.from(await file.arrayBuffer());

    const evidence = await uploadEvidenceToCase(session, id, {
      fileName: file.name || "evidence",
      contentType: file.type || "application/octet-stream",
      data,
      idempotencyKey,
      description,
      relevance: typeof relevance === "string" ? relevance : null,
    });

    return NextResponse.json({ evidence }, { status: 201 });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
