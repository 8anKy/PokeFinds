/**
 * AGENTS.md måste bära hela CLAUDE.md ordagrant.
 *
 * VARFÖR ETT TEST: Claude Code läser CLAUDE.md automatiskt, Codex och de flesta
 * andra agenter läser AGENTS.md. Glider de isär arbetar den ena agenten på ett
 * gammalt nuläge — den skulle till exempel kunna slå på en funktion som pausats
 * av kostnadsskäl, eller lansera något som är grindat i väntan på ägaren. Testet
 * gör en glömd `npx tsx scripts/sync-agents-md.ts` omöjlig att missa.
 */
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { MARKER, composeAgentsMd } from "../../scripts/sync-agents-md";

describe("AGENTS.md speglar CLAUDE.md", () => {
  const agents = readFileSync("AGENTS.md", "utf8");
  const claude = readFileSync("CLAUDE.md", "utf8");

  it("har markören som skiljer handskrivet från genererat", () => {
    expect(agents).toContain(MARKER);
  });

  it("är i takt — kör `npx tsx scripts/sync-agents-md.ts` om det här faller", () => {
    expect(composeAgentsMd(agents, claude)).toBe(agents);
  });

  it("bär CLAUDE.md:s hårdaste rader, inte en sammanfattning", () => {
    for (const phrase of [
      "Kostnadsdoktrin",
      "räkna väckningar",
      "Priser lagras i öre",
      "MIGRATIONEN MÅSTE LIGGA FÖRE KODEN",
      "with-prod-db",
    ]) {
      expect(agents, phrase).toContain(phrase);
    }
  });

  it("behåller den handskrivna delen ovanför markören", () => {
    const head = agents.split(MARKER)[0];
    expect(head).toContain("Så verifierar du innan du säger att något är klart");
    expect(head).toContain("Regelverk per delsystem");
  });
});
