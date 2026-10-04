/** fitWithin — graderingsfotots kapning (lib/grading-photo.ts). */
import { describe, expect, it } from "vitest";
import { fitWithin, GRADING_PHOTO_MAX } from "@/lib/grading-photo";

describe("fitWithin", () => {
  it("kapar längsta sidan och behåller proportionerna", () => {
    expect(fitWithin(8064, 6048, GRADING_PHOTO_MAX)).toEqual({ w: 2400, h: 1800 });
    expect(fitWithin(3024, 4032, 2400)).toEqual({ w: 1800, h: 2400 });
  });
  it("skalar aldrig upp och tål nollor", () => {
    expect(fitWithin(800, 600, 2400)).toEqual({ w: 800, h: 600 });
    expect(fitWithin(0, 600, 2400)).toEqual({ w: 0, h: 0 });
  });
});
