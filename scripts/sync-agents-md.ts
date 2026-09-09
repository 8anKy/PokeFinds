/**
 * SYNKAR AGENTS.md MOT CLAUDE.md.
 *
 * VARFÖR FILEN FINNS: Claude Code läser `CLAUDE.md` automatiskt, Codex och de
 * flesta andra agenter läser `AGENTS.md`. En pekare ("läs CLAUDE.md") räcker
 * inte — följer agenten den inte arbetar den utan nuläget: vad som är LIVE, vad
 * som är PAUSAT, vad som är GRINDAT och alla mätta tal som besluten vilar på.
 * Därför bär AGENTS.md hela CLAUDE.md ORDAGRANT.
 *
 * ⛔ REDIGERA ALDRIG DEN GENERERADE DELEN AV AGENTS.md FÖR HAND. Allt under
 *    markören nedan skrivs över. Ändringar i nuläget görs i CLAUDE.md — den är
 *    kanonisk — varefter du kör:
 *
 *      npx tsx scripts/sync-agents-md.ts
 *
 *    Delen OVANFÖR markören är handskriven och rörs aldrig av skriptet: den bär
 *    det som en agent utan Claude Codes automatik annars saknar (regelfilernas
 *    paths-tabell, hur man verifierar, att en push deployar).
 * ⛔ `tests/unit/agents-md-sync.test.ts` fäller sviten när filerna glidit isär,
 *    så en glömd körning kan inte bli tyst.
 */
import { readFile, writeFile } from "fs/promises";

export const MARKER = "<!-- GENERERAT AV scripts/sync-agents-md.ts — REDIGERA INTE NEDAN -->";

/** Handskriven del + markör + CLAUDE.md ordagrant. */
export function composeAgentsMd(existingAgents: string, claudeMd: string): string {
  const head = existingAgents.split(MARKER)[0].trimEnd();
  return `${head}\n\n${MARKER}\n\n${claudeMd.trimEnd()}\n`;
}

async function main() {
  const [agents, claude] = await Promise.all([readFile("AGENTS.md", "utf8"), readFile("CLAUDE.md", "utf8")]);
  const next = composeAgentsMd(agents, claude);
  if (next === agents) {
    console.log("AGENTS.md är redan i takt med CLAUDE.md.");
    return;
  }
  await writeFile("AGENTS.md", next, "utf8");
  console.log(`AGENTS.md uppdaterad — ${claude.split("\n").length} rader ur CLAUDE.md speglade.`);
}

if (process.argv[1]?.endsWith("sync-agents-md.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
