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
import {
  BLEND_COLOR,
  BLEND_DCT,
  BLEND_GRAD,
  FINGERPRINT_BYTES,
  STRUCT_BYTES,
  STRUCT_DCT_DIMS,
  cosineSimilarity,
  toUnitVector,
} from "@/lib/art-fingerprint";

/** Hur länge ett laddat index återanvänds. Katalogen växer ~1×/vecka. */
const TTL_MS = Number(process.env.ART_INDEX_TTL_MS ?? String(24 * 60 * 60 * 1000));

interface ArtIndex {
  ids: string[];
  /** Alla färgavtryck packade efter varandra: rad i börjar på i × FINGERPRINT_BYTES. */
  data: Int8Array;
  /** 1/‖rad‖ per kort, förberäknad så sökningen slipper en rot per jämförelse. */
  invNorm: Float32Array;
  /** Strukturavtrycken (dctb+grad), nollfyllda där kortet saknar dem. */
  struct: Int8Array;
  /** 1/‖dctb-del‖ resp 1/‖grad-del‖ per kort; 0 = saknas → delcosinus 0. */
  invDct: Float32Array;
  invGrad: Float32Array;
  loadedAt: number;
}

/** Fråga: färgavtryck + ev. strukturavtryck (äldre klienter skickar bara färg). */
export interface ArtQuery {
  color: Int8Array;
  struct: Int8Array | null;
}

let cache: ArtIndex | null = null;
let loading: Promise<ArtIndex | null> | null = null;

async function load(): Promise<ArtIndex | null> {
  const rows = await prisma.card.findMany({
    where: { artFingerprint: { not: null } },
    select: { id: true, artFingerprint: true, structFingerprint: true },
  });
  if (rows.length === 0) return null;

  const ids: string[] = [];
  const data = new Int8Array(rows.length * FINGERPRINT_BYTES);
  const invNorm = new Float32Array(rows.length);
  const struct = new Int8Array(rows.length * STRUCT_BYTES);
  const invDct = new Float32Array(rows.length);
  const invGrad = new Float32Array(rows.length);
  let n = 0;
  let missingStruct = 0;
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
    // Strukturavtrycket: saknas/fel längd → norm 0 → delcosinus 0, kortet
    // bär då bara färgdelen. Efter backfillen ska missingStruct vara ~0.
    const sb = row.structFingerprint;
    if (sb && sb.length === STRUCT_BYTES) {
      let nd = 0;
      let ng = 0;
      for (let i = 0; i < STRUCT_BYTES; i++) {
        const v = (sb[i] << 24) >> 24;
        struct[n * STRUCT_BYTES + i] = v;
        if (i < STRUCT_DCT_DIMS) nd += v * v;
        else ng += v * v;
      }
      invDct[n] = nd > 0 ? 1 / Math.sqrt(nd) : 0;
      invGrad[n] = ng > 0 ? 1 / Math.sqrt(ng) : 0;
    } else {
      missingStruct++;
    }
    ids.push(row.id);
    n++;
  }
  if (missingStruct > 0) {
    console.warn(
      `[art-index] ${missingStruct} kort saknar strukturavtryck — kör build-art-fingerprints.ts`
    );
  }
  return { ids: ids.slice(0, n), data, invNorm, struct, invDct, invGrad, loadedAt: Date.now() };
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
  query: ArtQuery,
  k = 15
): Promise<ArtMatch[]> {
  if (query.color.length !== FINGERPRINT_BYTES) return [];
  const index = await getArtIndex();
  if (!index) return [];

  const color = query.color;
  let qNorm = 0;
  for (let i = 0; i < FINGERPRINT_BYTES; i++) qNorm += color[i] * color[i];
  if (qNorm === 0) return []; // jämn yta — ingen information att matcha på
  const qInv = 1 / Math.sqrt(qNorm);

  // Frågans strukturdelar + deras normer (skalinvariant cosinus per del).
  const struct = query.struct && query.struct.length === STRUCT_BYTES ? query.struct : null;
  let qInvDct = 0;
  let qInvGrad = 0;
  if (struct) {
    let nd = 0;
    let ng = 0;
    for (let i = 0; i < STRUCT_DCT_DIMS; i++) nd += struct[i] * struct[i];
    for (let i = STRUCT_DCT_DIMS; i < STRUCT_BYTES; i++) ng += struct[i] * struct[i];
    qInvDct = nd > 0 ? 1 / Math.sqrt(nd) : 0;
    qInvGrad = ng > 0 ? 1 / Math.sqrt(ng) : 0;
  }

  const { ids, data, invNorm } = index;
  // Liten topplista via insertion — k är ~15, så en heap vore överarbetat.
  const top: ArtMatch[] = [];
  let worst = -Infinity;
  for (let r = 0; r < ids.length; r++) {
    const base = r * FINGERPRINT_BYTES;
    let dot = 0;
    for (let i = 0; i < FINGERPRINT_BYTES; i++) dot += color[i] * data[base + i];
    const cosColor = dot * qInv * invNorm[r];
    let score: number;
    if (struct) {
      // BLANDNINGEN ("triw", mätt 2026-07-30): 0,25·färg + 0,25·dctb + 0,5·grad.
      // Skärmfoto topp-15 38,5 % → 97,1 %, fysisk 93,2 % → 95,6 %. Kort utan
      // strukturavtryck får delcosinus 0 (invDct/invGrad = 0) — mindre bevis,
      // lägre poäng, vilket är ärligt.
      const sBase = r * STRUCT_BYTES;
      let dDct = 0;
      for (let i = 0; i < STRUCT_DCT_DIMS; i++) {
        dDct += struct[i] * index.struct[sBase + i];
      }
      let dGrad = 0;
      for (let i = STRUCT_DCT_DIMS; i < STRUCT_BYTES; i++) {
        dGrad += struct[i] * index.struct[sBase + i];
      }
      score =
        BLEND_COLOR * cosColor +
        BLEND_DCT * dDct * qInvDct * index.invDct[r] +
        BLEND_GRAD * dGrad * qInvGrad * index.invGrad[r];
    } else {
      // Äldre klient utan strukturavtryck → ren färgcosinus, som förut.
      score = cosColor;
    }
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
  fingerprints: ArtQuery[],
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

/**
 * Söker FLERA RUTOR av samma kort och behåller den MEST AVGÖRANDE rutan.
 *
 * Varje ruta är ett inset-svep (`searchByFingerprints`). Mellan rutor väljer vi
 * inte högsta poäng utan största MARGINAL till tvåan, för det är marginalen som
 * mätbart skiljer rätt från fel: över 250 kort nådde ingen felträff en marginal
 * över 0,066, medan rätta träffar ligger på 0,111 i median — och POÄNGEN
 * överlappar (felträff upp till 0,92, rätt träff ner till 0,57).
 *
 * ⛔ Slå INTE ihop rutor genom att ta max-poäng per kort över alla rutor. Det
 * plockar den lyckligaste observationen per kort och trycker ihop fältet, så
 * marginalen — hela vårt mått på tillförlitlighet — går förlorad. En dålig ruta
 * ska INTE kunna bidra med en enstaka hög poäng till ett fel kort.
 */
export async function searchByFrames(frames: ArtQuery[][], k = 15): Promise<ArtMatch[]> {
  const usable = frames.filter((f) => f.length > 0);
  if (usable.length === 0) return [];
  if (usable.length === 1) return searchByFingerprints(usable[0], k);

  let best: ArtMatch[] = [];
  let bestMargin = -Infinity;
  for (const frame of usable) {
    const res = await searchByFingerprints(frame, k);
    if (res.length === 0) continue;
    // Ensam träff = odefinierad marginal. Behandla som minst avgörande, men
    // behåll den som reserv om ingen annan ruta gav något.
    const margin = res.length >= 2 ? res[0].score - res[1].score : 0;
    if (margin > bestMargin) {
      bestMargin = margin;
      best = res;
    }
  }
  return best;
}

/**
 * Blandad likhet mellan TVÅ korts REFERENSAVTRYCK (samma triw-blandning som
 * sökningen). Används av omtryckssyskon-tie-breaken för att avgöra om två
 * namnsyskon har SAMMA konst — kalibrerat 2026-07-31 mot verkliga fall:
 * äkta samma-konst-omtryck 0,954–0,976 · olika konst 0,361–0,638.
 *
 * `indexOf` i stället för en id→rad-Map med flit: anropas för ett fåtal
 * kandidatpar per skanning, och en Map hade kostat ~2 MB residentminne för
 * att spara mikrosekunder — fel byte på en minnesfakturerad host.
 */
export async function artPairSimilarity(a: string, b: string): Promise<number | null> {
  const index = await getArtIndex();
  if (!index) return null;
  const ra = index.ids.indexOf(a);
  const rb = index.ids.indexOf(b);
  if (ra < 0 || rb < 0) return null;
  const { data, invNorm, struct, invDct, invGrad } = index;
  let dot = 0;
  for (let i = 0; i < FINGERPRINT_BYTES; i++) {
    dot += data[ra * FINGERPRINT_BYTES + i] * data[rb * FINGERPRINT_BYTES + i];
  }
  let s = BLEND_COLOR * dot * invNorm[ra] * invNorm[rb];
  if (invDct[ra] > 0 && invDct[rb] > 0) {
    let d = 0;
    for (let i = 0; i < STRUCT_DCT_DIMS; i++) {
      d += struct[ra * STRUCT_BYTES + i] * struct[rb * STRUCT_BYTES + i];
    }
    s += BLEND_DCT * d * invDct[ra] * invDct[rb];
  }
  if (invGrad[ra] > 0 && invGrad[rb] > 0) {
    let g = 0;
    for (let i = STRUCT_DCT_DIMS; i < STRUCT_BYTES; i++) {
      g += struct[ra * STRUCT_BYTES + i] * struct[rb * STRUCT_BYTES + i];
    }
    s += BLEND_GRAD * g * invGrad[ra] * invGrad[rb];
  }
  return s;
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
