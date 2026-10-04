/** Graderingsfotona sparas i bucketen — bästa försök (services/grading/photos.ts). */
import { beforeEach, describe, expect, it, vi } from "vitest";

const putImage = vi.fn();
let enabled = true;
vi.mock("@/lib/object-storage", async (orig) => ({
  ...(await orig<typeof import("@/lib/object-storage")>()),
  storageEnabled: () => enabled,
  putImage: (...a: unknown[]) => putImage(...a),
}));

import { storeGradingPhotos } from "@/services/grading/photos";

// Minsta JPEG-huvud som sniffImageType känner igen (FF D8 FF + utfyllnad).
const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString("base64")}`;
// En PNG som PÅSTÅR sig vara JPEG — typen tas ur bytesen.
const png = `data:image/jpeg;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64")}`;

beforeEach(() => {
  putImage.mockReset();
  enabled = true;
});

describe("storeGradingPhotos", () => {
  it("sparar båda sidorna under användarens prefix, typen ur bytesen", async () => {
    putImage.mockResolvedValue(undefined);
    const keys = await storeGradingPhotos("u1", "job1", jpeg, png);
    expect(keys).toEqual({ front: "grading/u1/job1_front.jpg", back: "grading/u1/job1_back.png" });
    expect(putImage).toHaveBeenCalledWith("grading/u1/job1_back.png", expect.any(Uint8Array), "image/png");
  });

  it("ingen bucket ⇒ null, inget anrop", async () => {
    enabled = false;
    expect(await storeGradingPhotos("u1", "job1", jpeg, jpeg)).toBeNull();
    expect(putImage).not.toHaveBeenCalled();
  });

  it("en sida som fallerar fäller inte den andra; båda ⇒ null (graderingen går ändå igenom)", async () => {
    putImage.mockImplementation((key: string) => (key.includes("front") ? Promise.reject(new Error("x")) : Promise.resolve()));
    expect(await storeGradingPhotos("u1", "job1", jpeg, jpeg)).toEqual({ front: null, back: "grading/u1/job1_back.jpg" });
    putImage.mockRejectedValue(new Error("down"));
    expect(await storeGradingPhotos("u1", "job1", jpeg, jpeg)).toBeNull();
  });
});
