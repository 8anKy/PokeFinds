import { describe, expect, it } from "vitest";
import {
  buildImageKey,
  extensionFor,
  isForumImageKey,
  sniffImageType,
  storageConfig,
} from "@/lib/object-storage";

describe("object-storage (rena delar)", () => {
  it("nyckeln bär användar-id:t och en giltig ändelse", () => {
    const key = buildImageKey("cm12abc_DEF-9", "image/jpeg");
    expect(key).toMatch(/^forum\/cm12abc_DEF-9\/[0-9a-f-]{36}\.jpg$/);
    expect(isForumImageKey(key!)).toBe(true);
    expect(buildImageKey("u1", "image/gif")).toBeNull();
    expect(buildImageKey("../etc", "image/png")).toMatch(/^forum\/etc\//);
    expect(buildImageKey("../", "image/png")).toBeNull();
  });

  it("isForumImageKey släpper bara igenom vår egen form", () => {
    expect(isForumImageKey("forum/u1/0f9c1d2e-1111-4222-8333-444455556666.png")).toBe(true);
    expect(isForumImageKey("forum/u1/../secret.jpg")).toBe(false);
    expect(isForumImageKey("other/u1/0f9c1d2e-1111-4222-8333-444455556666.jpg")).toBe(false);
    expect(isForumImageKey("forum/u1/0f9c1d2e-1111-4222-8333-444455556666.svg")).toBe(false);
  });

  it("magic bytes avgör typen, inte filändelsen", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(webp)).toBe("image/webp");
    expect(sniffImageType(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(sniffImageType(new Uint8Array(3))).toBeNull();
    expect(extensionFor("image/webp")).toBe("webp");
  });

  it("utan env är lagringen av — inget kastas", () => {
    const saved = { ...process.env };
    for (const k of ["S3_BUCKET", "BUCKET", "S3_ENDPOINT", "ENDPOINT", "S3_ACCESS_KEY_ID", "ACCESS_KEY_ID"]) {
      delete process.env[k];
    }
    try {
      expect(storageConfig()).toBeNull();
    } finally {
      Object.assign(process.env, saved);
    }
  });
});
