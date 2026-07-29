/**
 * BILDMATCHNING — söker kortets konstavtryck mot hela katalogen, i processminnet.
 *
 * VARFÖR SÖKNINGEN LIGGER PÅ SERVERN OCH INTE I KLIENTEN (kostnadsbeslut
 * 2026-07-29): indexet är ~5,4 MB. Skickas det till varje klient blir det
 * Railway-egress per besökare; läses det ur Neon per skanning blir det Neon-egress
 * per skanning (fritt lager har 5 GB/mån). Klienten skickar i stället 264 byte
 * UPP och får ~15 kort-id ner. Egress per skanning går från megabyte till
 * ungefär ett kilobyte.
 *
 * TRE REGLER SOM HÅLLER KOSTNADEN NERE — ändra dem inte utan att räkna om:
 *
 * 1. INT8 I MINNET, inte float32. 20 431 × 264 byte = 5,4 MB. Som float32 hade
 *    det varit 21,6 MB residentminne, och minne är ~92 % av Railway-notan
 *    (se project_railway_cost_model_and_meta_crawler). Skalärprodukten körs i
 *    heltal och normaliseras med en förberäknad radnorm.
 * 2. LADDAS LATT, aldrig vid uppstart eller på timer. Neon skalar till noll när
 *    ingen skannar; en laddning i modulens toppnivå hade väckt databasen vid
 *    varje deploy och vid varje kallstart oavsett om någon skannade.
 * 3. EN läsning per process, cachad för processens livstid. Katalogen ändras
 *    ~1×/vecka (nya set), så en färsk läsning per skanning vore rent slöseri.
 *    `ART_INDEX_TTL_MS` sätter ett tak så en långlivad process ändå hämtar nya
 *    kort inom ett dygn.
 */
import { prisma } from "@/lib/db";
import { FINGERPRINT_BYTES, cosineSimilarity, toUnitVector } from "@/lib/art-fingerprint";

/** Hur länge ett laddat index återanvänds. Katalogen växer ~1×/vecka. */
const TTL_MS = Number(process.env.ART_INDEX_TTL_MS ?? String(24 * 60 * 60 * 1000));

interface ArtIndex {
  ids: string[];
  /** Alla avtryck packade efter varandra: rad i börjar på i × FINGERPRINT_BYTES. */
  data: Int8Array;
  /** 1/‖rad‖ per kort, förberäknad så sökningen slipper en rot per jämförelse. */
  invNorm: Float32Array;
  loadedAt: number;
}

let cache: ArtIndex | null = null;
let loading: Promise<ArtIndex | null> | null = null;

async function load(): Promise<ArtIndex | null> {
  const rows = await prisma.card.findMany({
    where: { artFingerprint: { not: null } },
    select: { id: true, artFingerprint: true },
  });
  if (rows.length === 0) return null;

  const ids: string[] = [];
  const data = new Int8Array(rows.length * FINGERPRINT_BYTES);
  const invNorm = new Float32Array(rows.length);
  let n = 0;
  for (const row of rows) {
    const buf = row.artFingerprint;
    // Fel längd = avtryck från en annan rutnätsversion. Hoppa över det tyst
    // hellre än att jämföra vektorer av olika längd (vilket "fungerar" och ger
    // nonsens): kortet faller tillbaka på namn/nummer-matchningen.
    if (!buf || buf.length !== FINGERPRINT_BYTES) continue;
    let norm = 0;
    for (let i = 0; i < FINGERPRINT_BYTES; i++) {
      // Buffer bär int8 som 0..255 — tolka om till tecken.
      const v = (buf[i] << 24) >> 24;
      data[n * FINGERPRINT_BYTES + i] = v;
      norm += v * v;
    }
    invNorm[n] = norm > 0 ? 1 / Math.sqrt(norm) : 0;
    ids.push(row.id);
    n++;
  }
  return { ids: ids.slice(0, n), data, invNorm, loadedAt: Date.now() };
}

/** Laddat index, eller null när inga avtryck finns (t.ex. före backfillen). */
export async function getArtIndex(): Promise<ArtIndex | null> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache;
  // Samtidiga skanningar får INTE starta var sin laddning — det skulle läsa
  // 5,4 MB ur Neon flera gånger parallellt vid en kallstart.
  if (!loading) {
    loading = load()
      .then((idx) => {
        if (idx) cache = idx;
        return idx;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export interface ArtMatch {
  cardId: string;
  /** Cosinuslikhet 0..1. */
  score: number;
}

/**
 * Kortets K närmaste grannar på utseende.
 *
 * Linjär genomgång: 20 431 × 264 heltalsmultiplikationer ≈ 5,4 M, vilket är
 * några millisekunder. Ett ANN-index (HNSW/pgvector) skulle spara CPU vi inte
 * saknar och kosta minne vi betalar för — det är fel avvägning här.
 */
export async function searchByFingerprint(
  fingerprint: Int8Array,
  k = 15
): Promise<ArtMatch[]> {
  if (fingerprint.length !== FINGERPRINT_BYTES) return [];
  const index = await getArtIndex();
  if (!index) return [];

  let qNorm = 0;
  for (let i = 0; i < FINGERPRINT_BYTES; i++) qNorm += fingerprint[i] * fingerprint[i];
  if (qNorm === 0) return []; // jämn yta — ingen information att matcha på
  const qInv = 1 / Math.sqrt(qNorm);

  const { ids, data, invNorm } = index;
  // Liten topplista via insertion — k är ~15, så en heap vore överarbetat.
  const top: ArtMatch[] = [];
  let worst = -Infinity;
  for (let r = 0; r < ids.length; r++) {
    const base = r * FINGERPRINT_BYTES;
    let dot = 0;
    for (let i = 0; i < FINGERPRINT_BYTES; i++) dot += fingerprint[i] * data[base + i];
    const score = dot * qInv * invNorm[r];
    if (top.length < k) {
      top.push({ cardId: ids[r], score });
      if (top.length === k) {
        top.sort((a, b) => b.score - a.score);
        worst = top[k - 1].score;
      }
      continue;
    }
    if (score <= worst) continue;
    top[k - 1] = { cardId: ids[r], score };
    for (let j = k - 1; j > 0 && top[j].score > top[j - 1].score; j--) {
      const t = top[j];
      top[j] = top[j - 1];
      top[j - 1] = t;
    }
    worst = top[k - 1].score;
  }
  if (top.length < k) top.sort((a, b) => b.score - a.score);
  return top;
}

/**
 * Söker FLERA avtryck av samma kort (inset-svepet) och behåller varje korts
 * BÄSTA likhet.
 *
 * Varför max och inte medelvärde: avtrycken är samma kort beskuret olika, och
 * bara ETT av dem har rätt beskärning. De övriga är per definition sämre, så ett
 * medelvärde hade dragit ner rätt kort med brus från de felbeskurna varianterna
 * — vilket är precis det svepet finns för att undvika.
 */
export async function searchByFingerprints(
  fingerprints: Int8Array[],
  k = 15
): Promise<ArtMatch[]> {
  if (fingerprints.length === 0) return [];
  if (fingerprints.length === 1) return searchByFingerprint(fingerprints[0], k);

  const best = new Map<string, number>();
  for (const fp of fingerprints) {
    // Hämta djupare än k per variant: rätt kort kan ligga strax utanför k i en
    // felbeskuren variant men överst i den rätta, och då ska det ändå med.
    for (const m of await searchByFingerprint(fp, k * 2)) {
      const prev = best.get(m.cardId);
      if (prev === undefined || m.score > prev) best.set(m.cardId, m.score);
    }
  }
  return [...best.entries()]
    .map(([cardId, score]) => ({ cardId, score }))
    .sort((a, b) => b.score - a.score || a.cardId.localeCompare(b.cardId))
    .slice(0, k);
}

/** Antal kort i indexet — för diagnostikraden i skannern. */
export async function artIndexSize(): Promise<number> {
  const index = await getArtIndex();
  return index?.ids.length ?? 0;
}

/** Bara för tester: släng cachen. */
export function __resetArtIndexCache(): void {
  cache = null;
  loading = null;
}

export { toUnitVector, cosineSimilarity };
