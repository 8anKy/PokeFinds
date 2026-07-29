/**
 * SPIKE — mäter om ett billigt bild-fingeravtryck kan peka ut RÄTT kort.
 *
 * Referensmängd = HELA katalogen (alla cachade kort). Det är avgörande: mäter man
 * mot ett litet urval blir träffsäkerheten påhittat hög, eftersom svårigheten
 * ligger i att skilja kort som liknar varandra (111 Charizard, 178 Pikachu).
 *
 * Frågorna är samma bilder försämrade som en skärmfotografering
 * (`degradeAsScreenPhoto`). Se varningen där om vad siffran ÄR och inte är:
 * ett tak, inte verklig träffsäkerhet.
 *
 * Rapporterar topp-1, topp-5 och topp-15. Topp-15 är beslutsmåttet: hybriden
 * behöver bara att rätt kort finns i kandidatlistan — numret eller användaren
 * väljer sedan tryckning. Ett rimligt krav är topp-15 ≥ 95 %.
 *
 *   QUERIES=300 npx tsx scripts/_spike/eval.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { cachePath } from "./cache";
import { CONFIGS, PROFILES, cosine, degradeAsScreenPhoto, descriptor } from "./descriptor";

interface Card {
  id: string;
  name: string;
  number: string;
  set: string;
  url: string;
}

const CARDS = process.env.CARDS ?? ".spike/cards.json";
const CACHE = process.env.CACHE ?? ".spike/img-cache";
const QUERIES = Number(process.env.QUERIES ?? "300");
/** ONLY=grid8x11 kör bara en deskriptor (snabbt); PROFILE=harsh hårdare försämring. */
const ONLY = process.env.ONLY ?? "";
const PROFILE = PROFILES[process.env.PROFILE ?? "mild"] ?? PROFILES.mild;

interface Ref {
  card: Card;
  vec: Float32Array;
}

async function main() {
  const cards: Card[] = JSON.parse(readFileSync(CARDS, "utf8"));
  const available = cards.filter((c) => existsSync(cachePath(CACHE, c.id)));
  console.log(`katalog: ${cards.length} kort · cachade bilder: ${available.length}`);
  if (available.length < 100) {
    console.error("För få cachade bilder — kör fetch-images.ts först.");
    process.exitCode = 1;
    return;
  }

  // Deterministiskt frågeurval: var N:te cachade kort. Samma kort varje körning,
  // så två deskriptor-varianter jämförs på exakt samma frågor.
  const stride = Math.max(1, Math.floor(available.length / QUERIES));
  const queryCards: Card[] = [];
  for (let i = 0; i < available.length && queryCards.length < QUERIES; i += stride) {
    queryCards.push(available[i]);
  }
  console.log(`frågor: ${queryCards.length}\n`);

  console.log(`försämringsprofil: ${PROFILE.label}\n`);

  for (const config of CONFIGS) {
    if (ONLY && config.label !== ONLY) continue;
    process.stdout.write(`[${config.label}] bygger referensvektorer …`);
    const refs: Ref[] = [];
    for (const card of available) {
      const vec = await descriptor(readFileSync(cachePath(CACHE, card.id)), config);
      if (vec) refs.push({ card, vec });
    }
    process.stdout.write(` ${refs.length} st\n`);

    let top1 = 0;
    let top5 = 0;
    let top15 = 0;
    let scored = 0;
    const misses: string[] = [];

    for (const [qi, qcard] of queryCards.entries()) {
      const degraded = await degradeAsScreenPhoto(
        readFileSync(cachePath(CACHE, qcard.id)),
        qi + 1,
        PROFILE
      );
      if (!degraded) continue;
      const qvec = await descriptor(degraded, config);
      if (!qvec) continue;
      scored++;

      // Full genomsökning. 20k × ~600 dims är snabbt nog för en spike, och en
      // exakt sökning gör att siffran mäter DESKRIPTORN, inte ett ANN-index.
      let rank = 0;
      let selfScore = -Infinity;
      const scores = new Float64Array(refs.length);
      for (let i = 0; i < refs.length; i++) {
        const s = cosine(qvec, refs[i].vec);
        scores[i] = s;
        if (refs[i].card.id === qcard.id) selfScore = s;
      }
      for (let i = 0; i < refs.length; i++) if (scores[i] > selfScore) rank++;

      if (rank === 0) top1++;
      if (rank < 5) top5++;
      if (rank < 15) top15++;
      if (rank >= 15 && misses.length < 8) {
        let bestI = 0;
        for (let i = 1; i < refs.length; i++) if (scores[i] > scores[bestI]) bestI = i;
        misses.push(
          `${qcard.name} ${qcard.number} (${qcard.set}) → plats ${rank + 1}; etta blev ` +
            `${refs[bestI].card.name} ${refs[bestI].card.number} (${refs[bestI].card.set})`
        );
      }
    }

    const pct = (x: number) => `${((x / scored) * 100).toFixed(1)}%`.padStart(6);
    console.log(
      `[${config.label}] topp-1 ${pct(top1)} · topp-5 ${pct(top5)} · topp-15 ${pct(top15)}` +
        `   (n=${scored}, referenser=${refs.length})`
    );
    if (misses.length) {
      console.log("  missar utanför topp-15:");
      for (const m of misses) console.log(`    ${m}`);
    }
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
