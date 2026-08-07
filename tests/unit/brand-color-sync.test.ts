import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tradera-gulan bor på TVÅ ställen och måste vara samma värde:
 *   1. `SOURCE_COLORS.tradera` i product-price-card.tsx — prisgrafens serie
 *   2. `colors.tradera.DEFAULT` i tailwind.config.ts — knappen i /installningar
 *
 * De beskriver SAMMA varumärke för samma användare på samma svarta yta. Glider de
 * isär blir felet inte ett krasch utan något värre: två snarlika gula som läser
 * som "nästan samma sak", vilket är precis den tvetydighet SOURCE_COLORS-
 * kommentaren varnar för när den förbjuder en egen nyans åt "Tradera sålt".
 *
 * Färgen är dessutom kontrastvaliderad mot svart i den fyrfärgspaletten — en
 * godtycklig ändring på ena stället tappar den valideringen tyst.
 *
 * Kan inte importeras: product-price-card.tsx är en "use client"-komponent som
 * drar in recharts. Textprov är trubbigt men fångar exakt den drift det finns för
 * (samma metod som bulk-cap-sync.test.ts).
 */
function readHex(relPath: string, pattern: RegExp): string {
  const src = readFileSync(resolve(process.cwd(), relPath), "utf8");
  const m = src.match(pattern);
  expect(m, `hittade inte mönstret i ${relPath} — har konstanten döpts om?`).toBeTruthy();
  return m![1].toLowerCase();
}

describe("Traderas färg är samma i grafen och i knappen", () => {
  const chart = () =>
    readHex(
      "src/components/features/product-price-card.tsx",
      /tradera:\s*"(#[0-9a-fA-F]{6})"/
    );
  // Matchar `tradera: { DEFAULT: "#..." }` i colors-blocket. Ankaret är DEFAULT
  // direkt efter nyckeln, så `discord`-blocket ovanför inte plockas.
  const token = () =>
    readHex(
      "tailwind.config.ts",
      /tradera:\s*\{\s*DEFAULT:\s*"(#[0-9a-fA-F]{6})"/
    );

  it("prisgrafens serie och designtoken är samma hex", () => {
    expect(token()).toBe(chart());
  });

  it("färgen är inte av misstag appens turkos", () => {
    // #2dd4bf är signaturfärgen. Hamnar den här betyder det att någon
    // återställt knappen till standardstilen och tappat varumärkesskillnaden.
    expect(token()).not.toBe("#2dd4bf");
  });
});
