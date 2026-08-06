import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NATTKEDJAN (2026-08-05). Fyra jobb som förut hade var sin cron (02:00 / 04:00 /
 * 05:00 / 05:30) är länkade med `workflow_run` så att de bildar EN sammanhängande
 * körning. Skälet är Neons prismodell: notan är VAKEN TID och varje väckning köper
 * minst 300 s debiterad tid, så fyra spridda starter kostade fyra väckningar.
 *
 * ⛔ LÄNKEN ÄR EN STRÄNG SOM MATCHAS MOT ETT `name:`-FÄLT I EN ANNAN FIL. Byter någon
 *    namn på ett uppströmsjobb bryts kedjan TYST: jobbet slutar helt köra, ingen
 *    körning blir röd, och det syns först när Tradera-priser eller CardTrader-
 *    varianter börjat stå still i flera dygn. Exakt den sortens tysta bortfall som
 *    `bulk-cap-sync.test.ts` finns för — därför samma sorts vakt här.
 *
 * Testet läser filerna som TEXT (js-yaml är inget deklarerat beroende i det här
 * projektet, och en vakt ska inte införa ett).
 */
const DIR = resolve(__dirname, "../../.github/workflows");

const read = (file: string) => readFileSync(resolve(DIR, `${file}.yml`), "utf8");

/** `name: Foo (dagligen)` → "Foo (dagligen)". Första name: på radbörjan är jobbets. */
function workflowName(file: string): string {
  const m = read(file).match(/^name:\s*(.+?)\s*$/m);
  if (!m) throw new Error(`hittade inget name: i ${file}.yml`);
  return m[1].replace(/^["']|["']$/g, "");
}

/** `workflows: ["Foo"]` → "Foo". */
function upstreamName(file: string): string {
  const m = read(file).match(/^\s*workflows:\s*\[\s*["'](.+?)["']\s*\]/m);
  if (!m) throw new Error(`hittade ingen workflow_run-uppströmslänk i ${file}.yml`);
  return m[1];
}

// Kedjan, i ordning. Varje par är (jobb, dess uppströmsjobb).
const CHAIN: [downstream: string, upstream: string][] = [
  ["tradera-sweep", "scrape-all"],
  ["cardtrader-refresh", "tradera-sweep"],
  ["tradera-sold-sync", "cardtrader-refresh"],
  ["tradera-sold-sweep", "tradera-sold-sync"],
];

describe("nattkedjan av GitHub-workflows", () => {
  it.each(CHAIN)("%s pekar på %s:s faktiska name:", (downstream, upstream) => {
    expect(upstreamName(downstream)).toBe(workflowName(upstream));
  });

  // Bara kedjans FÖRSTA länk får ha en klocka. Får ett nedströmsjobb tillbaka sin
  // egen cron är vi tillbaka i fyra väckningar utan att någon märker det.
  it.each(CHAIN.map(([d]) => d))("%s har ingen egen schedule kvar", (file) => {
    expect(read(file)).not.toMatch(/^\s*schedule:/m);
  });

  it("scrape-all är den enda klockstyrda starten i kedjan", () => {
    expect(read("scrape-all")).toMatch(/^\s*- cron: "0 2 \* \* \*"/m);
  });

  // ⛔ Ingen `conclusion`-grind: jobben är oberoende och delar bara tidsfönster. Med
  // en success-grind hade ett misslyckat Tradera-svep tyst dödat de två efterföljande
  // jobben — en synlig röd körning utbytt mot två osynligt uteblivna.
  it.each(CHAIN.map(([d]) => d))("%s körs oavsett hur uppströmsjobbet slutade", (file) => {
    expect(read(file)).toMatch(/types:\s*\[completed\]/);
    expect(read(file)).not.toMatch(/workflow_run\.conclusion/);
  });

  it.each(CHAIN.map(([d]) => d))("%s går fortfarande att köra manuellt", (file) => {
    expect(read(file)).toMatch(/^\s*workflow_dispatch:/m);
  });
});
