import { NextResponse } from "next/server";
import { requireApiSession, ApiError } from "@/lib/auth/api-guard";
import { investigationErrorResponse } from "@/lib/investigations/investigation-api-errors";
import { updateInvestigationTask } from "@/lib/repositories/investigation-case-repository";
import { updateTaskSchema } from "@/lib/validation/investigations";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  try {
    const session = await requireApiSession();
    const { taskId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = updateTaskSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const task = await updateInvestigationTask(session, taskId, parsed.data);
    return NextResponse.json({ task });
  } catch (err) {
    return investigationErrorResponse(err);
  }
}
