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
const PAGES = [
  "src/app/[locale]/(marketing)/forum/page.tsx",
  "src/app/[locale]/(marketing)/forum/g/[slug]/page.tsx",
];

describe("forumets ISR-sidor prerenderas inte vid bygget", () => {
  for (const page of PAGES) {
    it(`${page} har en tom generateStaticParams`, () => {
      const src = readFileSync(page, "utf8");
      expect(src).toMatch(/export const revalidate = 300;/);
      expect(src).toMatch(/generateStaticParams\(\)\s*{\s*return \[\];\s*}/);
    });
  }
});
