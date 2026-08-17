import { describe, expect, it } from "vitest";
import { InvalidFileTypeError, validateUploadIdentity } from "@/lib/repositories/media-asset-repository";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const pdf = Buffer.from("%PDF- synthetic test document");

describe("Phase 18A private upload identity checks", () => {
  it("accepts matching safe extensions and signatures", () => {
    expect(() => validateUploadIdentity("synthetic-profile.png", "image/png", png)).not.toThrow();
    expect(() => validateUploadIdentity("synthetic-licence.pdf", "application/pdf", pdf)).not.toThrow();
  });

  it("rejects traversal, executable double extensions, MIME mismatches and forged signatures", () => {
    for (const sample of [
      ["../profile.png", "image/png", png], ["profile.exe.png", "image/png", png], ["profile.jpg", "image/png", png], ["profile.png", "image/png", Buffer.from("not an image")],
    ] as const) expect(() => validateUploadIdentity(sample[0], sample[1], sample[2])).toThrow(InvalidFileTypeError);
  });
});
