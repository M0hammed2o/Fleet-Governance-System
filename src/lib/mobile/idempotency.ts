import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/auth/api-guard";
import type { AuthenticatedSession } from "@/lib/auth/session";
import type { Prisma } from "@/generated/prisma/client";

function requestHash(operation: string, body: unknown): string {
  return crypto
    .createHash("sha256")
    .update(`${operation}\n${JSON.stringify(body)}`)
    .digest("hex");
}

function isUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function executeMobileMutation<T>(input: {
  session: AuthenticatedSession;
  key: string | null;
  operation: string;
  body: unknown;
  run(): Promise<T>;
}): Promise<{ value: T; replayed: boolean }> {
  if (!input.key || !/^[A-Za-z0-9._:-]{8,200}$/.test(input.key))
    throw new ApiError(400, "A valid Idempotency-Key is required.");
  const hash = requestHash(input.operation, input.body);
  let receipt;
  try {
    receipt = await prisma.mobileMutationReceipt.create({
      data: {
        tenantId: input.session.tenantId,
        userId: input.session.userId,
        idempotencyKey: input.key,
        operation: input.operation,
        requestHash: hash,
      },
    });
  } catch (error) {
    if (!isUniqueError(error)) throw error;
    const existing = await prisma.mobileMutationReceipt.findUnique({
      where: {
        tenantId_userId_idempotencyKey: {
          tenantId: input.session.tenantId,
          userId: input.session.userId,
          idempotencyKey: input.key,
        },
      },
    });
    if (
      !existing ||
      existing.operation !== input.operation ||
      existing.requestHash !== hash
    )
      throw new ApiError(
        409,
        "That idempotency key was already used for a different action.",
      );
    if (existing.status !== "COMPLETED" || existing.response == null)
      throw new ApiError(
        409,
        "The original action is still being processed. Refresh before retrying.",
      );
    return { value: existing.response as T, replayed: true };
  }
  let value: T;
  try {
    value = await input.run();
  } catch (error) {
    await prisma.mobileMutationReceipt
      .delete({ where: { id: receipt.id } })
      .catch(() => undefined);
    throw error;
  }
  const safeValue = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  // If finalization fails after the authoritative action succeeded, leave the
  // receipt IN_PROGRESS. A retry then fails closed instead of running twice.
  await prisma.mobileMutationReceipt.update({
    where: { id: receipt.id },
    data: {
      status: "COMPLETED",
      response: safeValue,
      completedAt: new Date(),
    },
  });
  return { value, replayed: false };
}
