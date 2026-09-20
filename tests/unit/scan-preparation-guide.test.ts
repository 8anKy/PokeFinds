import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const readJson = (path: string) =>
  JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as {
    Scanner: Record<string, string>;
  };

describe("skannerns bildguide", () => {
  it("levererar optimerade bra/dåliga exempel för båda lägena", () => {
    for (const name of ["single-good", "single-bad", "bulk-good", "bulk-bad"]) {
      const image = statSync(resolve(ROOT, `public/scan-guide/${name}.webp`));
      expect(image.size).toBeGreaterThan(10_000);
      expect(image.size).toBeLessThan(150_000);
    }
  });

  it("varnar uttryckligen för blänk och mönstrat underlag på båda språken", () => {
    const sv = readJson("messages/sv.json").Scanner;
    const en = readJson("messages/en.json").Scanner;

    expect(sv.scanGuideGlareWarning).toMatch(/blänk|reflex/i);
    expect(en.scanGuideGlareWarning).toMatch(/glare|reflection/i);
    expect(sv.scanGuideBulkTip1).toMatch(/ränder|mönster/i);
    expect(en.scanGuideBulkTip1).toMatch(/stripes|patterns/i);
  });

  it("pausar live-matchningen när guiden täcker kameran", () => {
    const page = readFileSync(
      resolve(ROOT, "src/app/[locale]/(scan)/skanna/page.tsx"),
      "utf8"
    );
    expect(page).toContain("guideMode !== null");
    expect(page).toContain('t("scanGuideOpenAria")');
  });

  it("låter inte zoomlagrets osynliga högerkant blockera informationsknappen", () => {
    const page = readFileSync(
      resolve(ROOT, "src/app/[locale]/(scan)/skanna/page.tsx"),
      "utf8"
    );
    expect(page).toContain('className="relative z-[40] flex items-center');
    expect(page).toContain(
      'className="pointer-events-none absolute inset-y-0 right-3 z-20'
    );
    expect(page).toContain(
      'className="pointer-events-auto flex flex-col items-center gap-1'
    );
  });
});
