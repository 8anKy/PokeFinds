/**
 * SPIKE — hämtar hem katalogens kortbilder till en diskcache.
 *
 * Resumerbar (hoppar över redan hämtade filer) så den kan avbrytas och köras om.
 * Väljer den LILLA bildvarianten när URL:en avslöjar en ("_hires" → utan): vi
 * skalar ändå ner till ett rutnät på några pixlar, så hi-res är bara bandbredd.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cachePath } from "./cache";

interface Card {
  id: string;
  name: string;
  number: string;
  set: string;
  url: string;
}

const CARDS = process.env.CARDS ?? ".spike/cards.json";
const CACHE = process.env.CACHE ?? ".spike/img-cache";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? "12");
const LIMIT = Number(process.env.LIMIT ?? "0"); // 0 = alla

/** Liten variant när URL:en har en; annars orörd. */
function smallVariant(url: string): string {
  return url.replace(/_hires(\.\w+)(\?|$)/i, "$1$2");
}

/** Relativa/egna URL:er pekar på vår bildproxy — gör dem absoluta. */
function absolute(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `https://www.foilio.se${url.startsWith("/") ? "" : "/"}${url}`;
}

async function main() {
  const cards: Card[] = JSON.parse(readFileSync(CARDS, "utf8"));
  const todo = LIMIT > 0 ? cards.slice(0, LIMIT) : cards;
  mkdirSync(CACHE, { recursive: true });

  let done = 0;
  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  const failures: string[] = [];

  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= todo.length) return;
      const card = todo[i];
      const path = cachePath(CACHE, card.id);
      done++;
      if (existsSync(path)) {
        skipped++;
        continue;
      }
      mkdirSync(join(path, ".."), { recursive: true });
      // Lilla varianten först (bandbredd), ORIGINALET som reserv: alla set har
      // inte en icke-hires-fil. Utan reserven 404:ade 134 kort — bl.a. hela
      // McDonald's-seten — och föll ur referensmängden av ren optimering.
      const candidates = [...new Set([absolute(smallVariant(card.url)), absolute(card.url)])];
      let lastErr = "";
      let ok = false;
      for (const url of candidates) {
        try {
          const res = await fetch(url, {
            headers: {
              // Tydlig user-agent, samma regel som skraparna (se CLAUDE.md).
              "user-agent": "FoilioScannerSpike/1.0 (+https://www.foilio.se)",
              referer: "https://www.foilio.se/",
            },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length < 512) throw new Error(`för liten (${buf.length} B)`);
          writeFileSync(path, buf);
          fetched++;
          ok = true;
          break;
        } catch (e) {
          lastErr = `${url} — ${e instanceof Error ? e.message : e}`;
        }
      }
      if (!ok) {
        failed++;
        if (failures.length < 20) failures.push(`${card.id} ${lastErr}`);
      }
      if (done % 500 === 0) {
        console.log(
          `${done}/${todo.length}  hämtade ${fetched} · cachade ${skipped} · fel ${failed}`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(
    `\nKLART: ${done} kort · hämtade ${fetched} · redan cachade ${skipped} · misslyckade ${failed}`
  );
  if (failures.length) {
    console.log("\nExempel på fel:");
    for (const f of failures) console.log(`  ${f}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
