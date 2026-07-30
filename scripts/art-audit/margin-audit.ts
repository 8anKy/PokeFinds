/**
 * REVISION — går det att LITA på en bildträff utifrån poäng och marginal?
 *
 * Bakgrund: modellens NAMN är opålitligt på skärmfotograferingar (samma kort gav
 * "Pelipper", "Pawmot", "Falinks", "Palafin ex" — det sista med konfidens 0,85).
 * Ett hallucinerat namn får full namnlikhet 1,0, medan rätt kort får ~0 på namn
 * och bara `art × ART_WEIGHT`. Ska bilden kunna överrösta namnet måste vi veta
 * NÄR en bildträff är att lita på.
 *
 * En observation från produktion: när bilden hade rätt låg tvåan långt efter
 * (Falinks TG07 0,857 mot Nessa 183 0,478 — marginal 0,379). Hypotesen är att
 * MARGINALEN mellan träff 1 och 2 skiljer säkra träffar från osäkra bättre än
 * poängen ensam. Skriptet mäter fördelningen i stället för att gissa ett tal ur
 * ett enda fall.
 *
 *   SAMPLES=200 PAD=0.03 node scripts/with-prod-db.mjs \
 *     npx tsx scripts/art-audit/margin-audit.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { FINGERPRINT_INSETS, fingerprintFromRgb } from "../../src/lib/art-fingerprint";
import { searchByFingerprints } from "../../src/services/scanner/art-index";
import { cachePath } from "./cache";
import { PROFILES, degradeAsScreenPhoto } from "./descriptor";

const prisma = new PrismaClient();

const CARDS = process.env.CARDS ?? ".spike/cards.json";
const CACHE = process.env.CACHE ?? ".spike/img-cache";
const SAMPLES = Number(process.env.SAMPLES ?? "200");
const PAD = Number(process.env.PAD ?? "0.03");

interface Card {
  id: string;
  name: string;
  number: string;
  set: string;
  url: string;
}

interface Obs {
  correct: boolean;
  score: number;
  margin: number;
}

function quantiles(xs: number[]): string {
  if (xs.length === 0) return "–";
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `min ${s[0].toFixed(3)} · p10 ${q(0.1).toFixed(3)} · median ${q(0.5).toFixed(3)} · p90 ${q(0.9).toFixed(3)} · max ${s[s.length - 1].toFixed(3)}`;
}

async function main() {
  const all: Card[] = JSON.parse(readFileSync(CARDS, "utf8"));
  const available = all.filter((c) => existsSync(cachePath(CACHE, c.id)));
  const stride = Math.max(1, Math.floor(available.length / SAMPLES));
  const sample: Card[] = [];
  for (let i = 0; i < available.length && sample.length < SAMPLES; i += stride) {
    sample.push(available[i]);
  }
  const profile = { ...PROFILES.harsh, pad: PAD };
  console.log(`urval: ${sample.length} kort · profil harsh + ${(PAD * 100).toFixed(0)} % marginal\n`);

  const obs: Obs[] = [];
  for (const [i, card] of sample.entries()) {
    const degraded = await degradeAsScreenPhoto(
      readFileSync(cachePath(CACHE, card.id)),
      i + 1,
      profile
    );
    if (!degraded) continue;
    const { data, info } = await sharp(degraded)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const fps = FINGERPRINT_INSETS.flatMap((inset) => {
      const fp = fingerprintFromRgb(data, info.width, info.height, 3, inset);
      return fp ? [fp] : [];
    });
    if (fps.length === 0) continue;
    // Färg-only-läget (struct: null) — mäter samma sak som före 2026-07-30.
    const res = await searchByFingerprints(fps.map((fp) => ({ color: fp, struct: null })), 5);
    if (res.length < 2) continue;
    obs.push({
      correct: res[0].cardId === card.id,
      score: res[0].score,
      margin: res[0].score - res[1].score,
    });
  }

  const right = obs.filter((o) => o.correct);
  const wrong = obs.filter((o) => !o.correct);
  console.log(`träff 1 RÄTT:  ${right.length}/${obs.length}`);
  console.log(`  poäng:    ${quantiles(right.map((o) => o.score))}`);
  console.log(`  marginal: ${quantiles(right.map((o) => o.margin))}`);
  console.log(`\nträff 1 FEL:   ${wrong.length}/${obs.length}`);
  console.log(`  poäng:    ${quantiles(wrong.map((o) => o.score))}`);
  console.log(`  marginal: ${quantiles(wrong.map((o) => o.margin))}`);

  // Vilken regel släpper igenom flest RÄTT och minst FEL? Precisionen är det som
  // betyder något: en regel som låter bilden överrösta namnet måste ha rätt när
  // den gör det, annars byter vi ett fel mot ett annat.
  console.log("\nregel: poäng ≥ S OCH marginal ≥ M → lita på bilden");
  console.log("   S     M   täcker rätt   släpper fel   precision");
  for (const S of [0.7, 0.75, 0.8]) {
    for (const M of [0.1, 0.15, 0.2, 0.25]) {
      const tp = right.filter((o) => o.score >= S && o.margin >= M).length;
      const fp = wrong.filter((o) => o.score >= S && o.margin >= M).length;
      const prec = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 100;
      console.log(
        `${S.toFixed(2)}  ${M.toFixed(2)}   ` +
          `${String(tp).padStart(4)}/${String(right.length).padEnd(4)}   ` +
          `${String(fp).padStart(4)}/${String(wrong.length).padEnd(4)}      ${prec.toFixed(1)} %`
      );
    }
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
