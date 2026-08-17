import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SourceType } from "@prisma/client";
import { getAdapter } from "@/scrapers/runner";

/**
 * En butik identifieras av sitt NAMN på tre ställen som måste vara samma sträng:
 *   1. `ScrapeSource.name` i databasen (sätts av scripts/setup-wave4-sources.ts)
 *   2. nyckeln i `SCRAPER_ADAPTERS` i runner.ts — det getAdapter slår upp på
 *   3. adapterns egen `name` — det `getRetailerForSource` skapar butiken med
 *
 * Glider 1 och 2 isär kastar körningen "Ingen scraper-adapter för …" mitt i
 * nattkedjan. Glider 2 och 3 isär är det VÄRRE och helt tyst: jobbet kör, men
 * skriver sina offers på en Retailer med ett annat namn än källan — butiken
 * dubbleras i gränssnittet och länkrevisionen jämför fel rader.
 *
 * Testet läser namnen ur skriptets egen lista, så en ny butik som glömts i
 * registret failar här i stället för i produktion klockan 02:00.
 */
function setupScriptBlocks(): string[] {
  // Varje våg har sitt eget setup-skript — testet läser ALLA så en ny butik som
  // glömts i registret failar här i stället för i produktion klockan 02:00.
  const files: Array<[string, RegExp]> = [
    ["scripts/setup-wave4-sources.ts", /const WAVE4[\s\S]*?\n\];/],
    ["scripts/setup-wave5-sources.ts", /const WAVE5[\s\S]*?\n\];/],
    ["scripts/setup-wave6-sources.ts", /const WAVE6[\s\S]*?\n\];/],
  ];
  return files.map(([f, re]) => {
    const src = readFileSync(resolve(process.cwd(), f), "utf8");
    const block = src.match(re)?.[0];
    if (!block) throw new Error(`Hittade inte butikslistan i ${f}`);
    return block;
  });
}

function storeNamesFromSetupScript(): string[] {
  return setupScriptBlocks().flatMap((block) =>
    [...block.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1])
  );
}

describe("adapter-registret", () => {
  const names = storeNamesFromSetupScript();

  it("hittar listan i setup-skriptet", () => {
    expect(names.length).toBeGreaterThan(20);
  });

  it("har en adapter för varje butik i setup-skriptet", () => {
    for (const name of names) {
      expect(() => getAdapter(SourceType.SCRAPER, name), `saknar adapter: ${name}`).not.toThrow();
    }
  });

  it("adapterns egen `name` är identisk med registernyckeln", () => {
    for (const name of names) {
      expect(getAdapter(SourceType.SCRAPER, name).name, `registernyckel "${name}"`).toBe(name);
    }
  });

  it("varje adapter har en https-bas-URL utan avslutande slash", () => {
    for (const name of names) {
      const { baseUrl } = getAdapter(SourceType.SCRAPER, name);
      expect(baseUrl, name).toMatch(/^https:\/\//);
      expect(baseUrl.endsWith("/"), `${name}: baseUrl slutar med slash`).toBe(false);
    }
  });

  it("bas-URL:en i setup-skriptet är samma som adapterns", () => {
    const pairs = setupScriptBlocks().flatMap((block) =>
      [...block.matchAll(/name:\s*"([^"]+)",\s*baseUrl:\s*"([^"]+)"/g)]
    );
    expect(pairs.length).toBe(names.length);
    for (const [, name, baseUrl] of pairs) {
      expect(getAdapter(SourceType.SCRAPER, name).baseUrl, name).toBe(baseUrl);
    }
  });

  it("två butiker delar aldrig bas-URL", () => {
    const seen = new Map<string, string>();
    for (const name of names) {
      const { baseUrl } = getAdapter(SourceType.SCRAPER, name);
      expect(seen.has(baseUrl), `${name} delar baseUrl med ${seen.get(baseUrl)}`).toBe(false);
      seen.set(baseUrl, name);
    }
  });
});
