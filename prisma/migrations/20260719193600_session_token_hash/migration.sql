-- Add tokenHash to sessions: SHA-256 hex digest of the opaque bearer token in the
-- session cookie. Table has no rows yet in any environment this migration has run
-- in, so NOT NULL can be added directly without a backfill step.
ALTER TABLE "sessions" ADD COLUMN "tokenHash" TEXT NOT NULL;

CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");
