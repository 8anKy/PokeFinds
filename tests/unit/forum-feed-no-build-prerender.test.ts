import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ⛔ Trådflödet får ALDRIG prerenderas vid bygget: `next build` kör utan S3-env,
 * så `imageUrl()` ger null och den prerenderade HTML:en saknar bildtaggarna helt.
 * Cache-handlerns seed-lager serverar den filen efter varje deploy — symptomet var
 * att flödets bilder försvann "ibland" medan den öppnade tråden alltid visade dem.
 * En tom `generateStaticParams` behåller ISR men flyttar första renderingen till
 * runtime. Samma mönster som gruppsidan.
 */
const PAGES: Array<[string, number]> = [
  ["src/app/[locale]/(marketing)/forum/page.tsx", 300],
  ["src/app/[locale]/(marketing)/forum/g/[slug]/page.tsx", 300],
  // Nyhetsflödet läser en fil på volymen — samma fälla (2026-09-11: tomt flöde bakat i bygget).
  ["src/app/[locale]/(marketing)/nyheter/page.tsx", 3600],
  ["src/app/[locale]/(marketing)/evenemang/page.tsx", 3600],
];

describe("ISR-sidor som beror på runtime-miljön prerenderas inte vid bygget", () => {
  for (const [page, ttl] of PAGES) {
    it(`${page} har en tom generateStaticParams`, () => {
      const src = readFileSync(page, "utf8");
      expect(src).toMatch(new RegExp(`export const revalidate = ${ttl};`));
      expect(src).toMatch(/generateStaticParams\(\)\s*{\s*return \[\];\s*}/);
    });
  }
});
