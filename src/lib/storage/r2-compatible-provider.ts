import "server-only";
import crypto from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, HeadBucketCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { ObjectStorageProvider, StoredFile, ReadFileResult, PresignedUpload, ConfirmUploadResult, StorageProviderCapabilities, StorageHealthResult } from "@/lib/storage/provider";
import type { MediaCategory } from "@/generated/prisma/client";

/**
 * Cloudflare R2 configuration boundary (Phase 8B) — **no Cloudflare account
 * has been opened for this project** (hard rule: paid third-party account
 * requires the user's explicit sign-off first, same status as
 * facial-verification/telematics vendor selection — INTEGRATIONS.md).
 *
 * R2 is S3-API-compatible, so this is written against the real
 * `@aws-sdk/client-s3` client pointed at R2's endpoint shape
 * (`https://<accountId>.r2.cloudflarestorage.com`) rather than a hand-rolled
 * HTTP client — the same class would work against R2 once real credentials
 * exist, with no code change, only an environment-variable change. Every
 * method throws `R2NotConfiguredError` unless `R2_ACCOUNT_ID`/
 * `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME` are all set —
 * none of which are set anywhere in this repo's `.env*` files, so this
 * provider is never actually reachable in dev/test/CI. Presigned-URL
 * generation (`createPresignedUpload`/`getSignedReadUrl`) is pure local
 * SigV4 signing (no network call), so it's directly unit-testable by
 * constructing this class with an explicit (non-real) config object — see
 * `tests/r2-compatible-provider.test.ts` — without ever touching a real
 * account. `store`/`read`/`delete`/`confirmUpload` do make a real network
 * call and are therefore unverified against an actual R2 bucket, same
 * "blocked pending vendor decision" status as every other unselected
 * provider in this codebase.
 */
export class R2NotConfiguredError extends Error {
  constructor() {
    super(
      "R2CompatibleStorageProvider is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
        "R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME. No Cloudflare account has been created for this " +
        "project yet — see INTEGRATIONS.md.",
    );
    this.name = "R2NotConfiguredError";
  }
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

export function loadR2ConfigFromEnv(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) return null;
  return { accountId, accessKeyId, secretAccessKey, bucketName };
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && ("name" in err) && (err as { name?: string }).name === "NotFound";
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  // The SDK's response Body is a Node.js Readable in the Node runtime.
  const stream = body as AsyncIterable<Uint8Array>;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export class R2CompatibleStorageProvider implements ObjectStorageProvider {
  readonly providerId = "r2-compatible";
  readonly capabilities: StorageProviderCapabilities = {
    privateObjects: true,
    tenantPrefixedKeys: true,
    signedReads: true,
    presignedUploads: true,
    integrityMetadata: true,
    deleteObjects: true,
    archiveTier: false,
    legalHoldApi: false,
    credentialRotation: true,
  };
  private readonly config: R2Config | null;
  private readonly client: S3Client | null;

  constructor(config: R2Config | null = loadR2ConfigFromEnv()) {
    this.config = config;
    this.client = config
      ? new S3Client({
          region: "auto",
          endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
          credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
          maxAttempts: 3,
          requestHandler: new NodeHttpHandler({ connectionTimeout: 5_000, requestTimeout: 15_000 }),
        })
      : null;
  }

  async healthCheck(): Promise<StorageHealthResult> {
    if (!this.client || !this.config) {
      return { status: "not_configured", detail: "durable object storage is not configured" };
    }
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucketName }));
      return { status: "healthy", detail: "durable object storage is reachable" };
    } catch {
      return { status: "degraded", detail: "durable object storage is unavailable" };
    }
  }

  get isConfigured(): boolean {
    return this.config !== null;
  }

  private requireClient(): { client: S3Client; config: R2Config } {
    if (!this.client || !this.config) throw new R2NotConfiguredError();
    return { client: this.client, config: this.config };
  }

  private buildStorageKey(tenantId: string, category: MediaCategory, fileName: string): string {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
    return `${tenantId}/${category}/${crypto.randomUUID()}-${safeName}`;
  }

  async store(tenantId: string, category: MediaCategory, fileName: string, data: Buffer, contentType: string): Promise<StoredFile> {
    const { client, config } = this.requireClient();
    const storageKey = this.buildStorageKey(tenantId, category, fileName);
    await client.send(new PutObjectCommand({ Bucket: config.bucketName, Key: storageKey, Body: data, ContentType: contentType }));
    const checksumSha256 = crypto.createHash("sha256").update(data).digest("hex");
    return { storageKey, checksumSha256, fileSizeBytes: data.byteLength };
  }

  async createPresignedUpload(
    tenantId: string,
    category: MediaCategory,
    fileName: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<PresignedUpload> {
    const { client, config } = this.requireClient();
    const storageKey = this.buildStorageKey(tenantId, category, fileName);
    const command = new PutObjectCommand({ Bucket: config.bucketName, Key: storageKey, ContentType: contentType });
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    return {
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": contentType },
      storageKey,
      expiresAt: Math.floor(Date.now() / 1000) + expiresInSeconds,
    };
  }

  async confirmUpload(storageKey: string): Promise<ConfirmUploadResult> {
    const { client, config } = this.requireClient();
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: config.bucketName, Key: storageKey }));
      return { exists: true, fileSizeBytes: head.ContentLength ?? null };
    } catch (err) {
      if (isNotFound(err)) return { exists: false, fileSizeBytes: null };
      throw err;
    }
  }

  async getSignedReadUrl(storageKey: string, expiresInSeconds: number): Promise<string> {
    const { client, config } = this.requireClient();
    const command = new GetObjectCommand({ Bucket: config.bucketName, Key: storageKey });
    return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }

  async read(storageKey: string): Promise<ReadFileResult | null> {
    const { client, config } = this.requireClient();
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: config.bucketName, Key: storageKey }));
      const data = await streamToBuffer(result.Body);
      return { data, contentType: result.ContentType ?? "application/octet-stream" };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const { client, config } = this.requireClient();
    await client.send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: storageKey }));
  }
}
