/**
 * SPIKE-KONTROLL — är försämringen tillräckligt hård för att siffran ska betyda något?
 *
 * Träffsäkerheten i eval.ts (topp-15 ~100 %) är bara meningsfull om frågebilden
 * FAKTISKT är svår. En försämringskedja som råkar lämna bilden nästan orörd ger
 * en fantastisk siffra som mäter ingenting — och det är precis den sortens fel
 * som ser ut som succé. Två kontroller:
 *
 *   1. Cosinuslikheten mellan kortets EGEN referens och dess försämrade fråga.
 *      Ligger den kring 0,999 är försämringen kosmetisk. Den ska ligga MÄRKBART
 *      under 1 och ändå över konkurrenternas — marginalen är vad matchningen
 *      lever på.
 *   2. Ett par försämrade bilder skrivs till disk så de går att TITTA på och
 *      jämföra med hur en riktig skärmfotografering ser ut.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { cachePath } from "./cache";
import { CONFIGS, cosine, degradeAsScreenPhoto, descriptor } from "./descriptor";

interface Card {
  id: string;
  name: string;
  number: string;
  set: string;
  url: string;
}

const CARDS = process.env.CARDS ?? ".spike/cards.json";
const CACHE = process.env.CACHE ?? ".spike/img-cache";
const SAMPLES = Number(process.env.SAMPLES ?? "60");

async function main() {
  const cards: Card[] = JSON.parse(readFileSync(CARDS, "utf8"));
  const available = cards.filter((c) => existsSync(cachePath(CACHE, c.id)));

  const stride = Math.max(1, Math.floor(available.length / SAMPLES));
  const sample: Card[] = [];
  for (let i = 0; i < available.length && sample.length < SAMPLES; i += stride) {
    sample.push(available[i]);
  }

  for (const config of CONFIGS) {
    const sims: number[] = [];
    for (const [i, card] of sample.entries()) {
      const orig = readFileSync(cachePath(CACHE, card.id));
      const deg = await degradeAsScreenPhoto(orig, i + 1);
      if (!deg) continue;
      const a = await descriptor(orig, config);
      const b = await descriptor(deg, config);
      if (a && b) sims.push(cosine(a, b));
    }
    sims.sort((x, y) => x - y);
    const mean = sims.reduce((s, x) => s + x, 0) / sims.length;
    console.log(
      `[${config.label}] självlikhet efter försämring: ` +
        `median ${sims[Math.floor(sims.length / 2)].toFixed(3)} · ` +
        `medel ${mean.toFixed(3)} · lägsta ${sims[0].toFixed(3)} · högsta ${sims[sims.length - 1].toFixed(3)}`
    );
  }

  // Skriv ut ett par exempel att titta på — helst ett full-art-kort, eftersom
  // Trainer Gallery är just det fall vi vet är svårt i verkligheten.
  const picks = [
    available.find((c) => /Trainer Gallery/i.test(c.set)),
    available.find((c) => /Charizard/i.test(c.name)),
    available[0],
  ].filter(Boolean) as Card[];

  for (const [i, card] of picks.entries()) {
    const orig = readFileSync(cachePath(CACHE, card.id));
    const deg = await degradeAsScreenPhoto(orig, i + 1);
    if (!deg) continue;
    const label = `${i}-${card.name.replace(/[^\w]+/g, "_")}`;
    // Original och försämrad sida vid sida, samma höjd, för direkt jämförelse.
    const left = await sharp(orig).resize(400, 559, { fit: "fill" }).jpeg().toBuffer();
    const right = await sharp(deg).resize(400, 559, { fit: "fill" }).jpeg().toBuffer();
    const out = await sharp({
      create: { width: 810, height: 559, channels: 3, background: "#111" },
    })
      .composite([
        { input: left, left: 0, top: 0 },
        { input: right, left: 410, top: 0 },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
    const path = `.spike/sanity-${label}.jpg`;
    writeFileSync(path, out);
    console.log(`skrev ${path}  (${card.name} ${card.number} · ${card.set})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
