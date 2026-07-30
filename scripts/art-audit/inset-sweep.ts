/**
 * REVISION — räddar en INSET-SVEP avtrycket när ramen inte sitter tätt?
 *
 * Avtrycket är känsligt för hur mycket bakgrund som ligger runt kortet (mätt:
 * topp-15 96 % vid 0 % marginal, 84 % vid 2 %, 15 % vid 6 %). Att ta bort
 * kameravyns fasta `CROP_PAD` fixar den systematiska delen, men en handhållen
 * fångst sitter inte inom 1–2 %.
 *
 * Hypotesen som mäts här: låt KLIENTEN skicka flera avtryck — samma bild beskuren
 * med olika inset — och låt servern ta det bästa. Det är billigt (varje sökning är
 * ~10 ms mot ett index i minnet, och varje avtryck är 264 byte), kräver ingen
 * ombyggnad av indexet och ingen kantdetektering.
 *
 *   INSETS=0,0.03,0.06,0.09 PADS=0.02,0.04,0.06 SAMPLES=100 \
 *     node scripts/with-prod-db.mjs npx tsx scripts/art-audit/inset-sweep.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { fingerprintFromRgb } from "../../src/lib/art-fingerprint";
import { searchByFingerprint } from "../../src/services/scanner/art-index";
import { cachePath } from "./cache";
import { PROFILES, degradeAsScreenPhoto } from "./descriptor";

const prisma = new PrismaClient();

const CARDS = process.env.CARDS ?? ".spike/cards.json";
const CACHE = process.env.CACHE ?? ".spike/img-cache";
const SAMPLES = Number(process.env.SAMPLES ?? "100");
const PADS = (process.env.PADS ?? "0.02,0.04,0.06").split(",").map(Number);
const INSETS = (process.env.INSETS ?? "0,0.03,0.06,0.09").split(",").map(Number);

interface Card {
  id: string;
  name: string;
  number: string;
  set: string;
  url: string;
}

/** Avtryck ur den inre (1−2·inset) delen — via DELAD produktionskod, inte via en
 *  förhandsbeskärning i sharp, så revisionen mäter exakt vad klienten räknar. */
async function fpAtInset(buf: Buffer, inset: number) {
  const { data, info } = await sharp(buf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return fingerprintFromRgb(data, info.width, info.height, 3, inset);
}

async function main() {
  const all: Card[] = JSON.parse(readFileSync(CARDS, "utf8"));
  const available = all.filter((c) => existsSync(cachePath(CACHE, c.id)));
  const stride = Math.max(1, Math.floor(available.length / SAMPLES));
  const sample: Card[] = [];
  for (let i = 0; i < available.length && sample.length < SAMPLES; i += stride) {
    sample.push(available[i]);
  }
  console.log(`urval: ${sample.length} kort · insets: ${INSETS.join(", ")}\n`);

  for (const pad of PADS) {
    const profile = { ...PROFILES.harsh, pad };
    let bestTop1 = 0;
    let bestTop15 = 0;
    // Hur ofta räcker ETT enda avtryck (inset 0) — dvs dagens beteende?
    let singleTop1 = 0;
    let singleTop15 = 0;
    let n = 0;

    for (const [i, card] of sample.entries()) {
      const degraded = await degradeAsScreenPhoto(
        readFileSync(cachePath(CACHE, card.id)),
        i + 1,
        profile
      );
      if (!degraded) continue;
      n++;
      let best = Number.POSITIVE_INFINITY;
      for (const [k, inset] of INSETS.entries()) {
        const fp = await fpAtInset(degraded, inset);
        if (!fp) continue;
        // Färg-only-läget (struct: null) — mäter samma sak som före 2026-07-30.
        const res = await searchByFingerprint({ color: fp, struct: null }, 15);
        const rank = res.findIndex((r) => r.cardId === card.id);
        const r = rank < 0 ? Number.POSITIVE_INFINITY : rank;
        if (k === 0) {
          if (r === 0) singleTop1++;
          if (r < 15) singleTop15++;
        }
        if (r < best) best = r;
      }
      if (best === 0) bestTop1++;
      if (best < 15) bestTop15++;
    }

    const pct = (x: number) => `${((x / n) * 100).toFixed(1)}%`.padStart(6);
    console.log(
      `marginal ${(pad * 100).toFixed(0).padStart(2)} %  ` +
        `ETT avtryck: topp-1 ${pct(singleTop1)} topp-15 ${pct(singleTop15)}   ` +
        `SVEP (${INSETS.length} avtryck): topp-1 ${pct(bestTop1)} topp-15 ${pct(bestTop15)}   (n=${n})`
    );
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
