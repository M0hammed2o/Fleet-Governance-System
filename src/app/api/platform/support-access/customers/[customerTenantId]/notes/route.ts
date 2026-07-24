import { NextResponse } from "next/server";
import { requireApiSession, apiErrorResponse, ApiError } from "@/lib/auth/api-guard";
import { createSupportNote, CustomerTenantNotFoundError } from "@/lib/repositories/support-access-repository";
import { createSupportNoteSchema } from "@/lib/validation/support-access";

export async function POST(request: Request, { params }: { params: Promise<{ customerTenantId: string }> }) {
  try {
    const session = await requireApiSession();
    const { customerTenantId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = createSupportNoteSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const note = await createSupportNote(session, customerTenantId, parsed.data.note);
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    if (err instanceof CustomerTenantNotFoundError) return apiErrorResponse(new ApiError(404, err.message));
    return apiErrorResponse(err);
  }
}
