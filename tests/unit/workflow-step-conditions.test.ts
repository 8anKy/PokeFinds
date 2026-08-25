import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * UNDERHÅLLSJOBBENS STEG FÅR INTE SVÄLTA VARANDRA.
 *
 * Ett `if:` i GitHub Actions UTAN statusfunktion får implicit `success()`. I ett jobb
 * där varje steg bär `if: steps.guard.outputs.ready == 'true'` betyder det att ETT rött
 * steg tyst hoppar över ALLT efter sig — utan att någonting i loggen säger att det
 * hände. Stegen i de här två jobben är OBEROENDE underhållsuppgifter som bara delar
 * tidsfönster (samma skäl som nattkedjan saknar `conclusion`-grind), så ett fallerat
 * steg får aldrig vara ett skäl att strypa resten.
 *
 * Fällan har slagit till TVÅ gånger:
 *   • store-health.yml — `be9266d` la villkoret från gtin-report och nedåt men missade
 *     audit-links, som därmed uteblev 2026-08-10 och 2026-08-17 för att en helt
 *     orelaterad butik var onåbar.
 *   • import-new-sets.yml — pokemontcg.io `/v2/sets` svarade 500 den 2026-08-23, och
 *     nämnarsteget tog med sig BÅDE bildlagningen och avtrycksbygget i fallet
 *     (`skipped` i körning 32617045678). Priset för de två är att kort blir osynliga
 *     för skannerns bildmatchning — helt utan koppling till nämnarna.
 *
 * Jobbet blir ändå rött av det fallerade steget, så larmet (GitHub mejlar ägaren vid
 * röd körning) består. Det som återställs är bara att resten av underhållet KÖRS.
 *
 * Testet läser filerna som TEXT — js-yaml är inget deklarerat beroende i projektet,
 * och en vakt ska inte införa ett.
 */
const DIR = resolve(__dirname, "../../.github/workflows");

const read = (file: string) => readFileSync(resolve(DIR, `${file}.yml`), "utf8");

interface Step {
  /** Skriptets sökväg, t.ex. "scripts/audit-links.ts". */
  script: string;
  /** Hela stegets YAML-block. */
  block: string;
}

/**
 * Plockar ut varje steg som kör ett `npx tsx scripts/…`-skript, i filordning.
 * Ett steg börjar på `      - ` och löper till nästa steg på samma indrag.
 */
function scriptSteps(file: string): Step[] {
  const text = read(file);
  const blocks = text.split(/\n(?=      - )/);
  const steps: Step[] = [];
  for (const block of blocks) {
    const m = block.match(/npx tsx (scripts\/[\w-]+\.ts)/);
    if (m) steps.push({ script: m[1], block });
  }
  return steps;
}

// Jobben vars steg är oberoende underhållsuppgifter. Läggs ett nytt sådant jobb till
// hör det hemma här — annars upptäcks nästa tysta bortfall först när någon läser en
// loggfil av ren nyfikenhet.
const MAINTENANCE_JOBS = ["store-health", "import-new-sets"] as const;

describe("underhållsjobbens stegvillkor", () => {
  it.each(MAINTENANCE_JOBS)("%s.yml kör faktiskt flera skriptsteg", (file) => {
    // Sanity: går regexen sönder blir alla påståenden nedan vakuöst sanna.
    expect(scriptSteps(file).length).toBeGreaterThan(1);
  });

  // Det FÖRSTA skriptsteget behöver ingen statusfunktion: före det finns bara
  // checkout/npm ci/prisma generate, och faller något av dem är det rätt att stanna.
  it.each(MAINTENANCE_JOBS)("varje steg efter det första i %s.yml bär !cancelled()", (file) => {
    const steps = scriptSteps(file);
    const missing = steps
      .slice(1)
      .filter((s) => !/!cancelled\(\)/.test(s.block))
      .map((s) => s.script);
    expect(missing).toEqual([]);
  });

  // `!cancelled()` (inte `always()`): ett jobb som slår i timeout-taket eller avbryts
  // för hand ska ge upp direkt. `always()` hade tvingat kvarvarande steg att köra
  // klart i ett jobb som redan är på väg att dö — och store-health CANCELLADES
  // faktiskt mitt i audit-links tre veckor i rad innan taket höjdes till 60 min.
  it.each(MAINTENANCE_JOBS)("%s.yml använder inte always()", (file) => {
    expect(read(file)).not.toMatch(/always\(\)/);
  });
});
