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
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SCANNER_INCLUDED_CARD } from "@/lib/scanner-exclusion";
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
import { ART_KERNEL_WASM_BASE64 } from "./art-kernel.generated";

/** Hur länge ett laddat index återanvänds. Katalogen växer ~1×/vecka. */
const TTL_MS = Number(
  process.env.ART_INDEX_TTL_MS ?? String(24 * 60 * 60 * 1000)
);

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
  /** SIMD-kärnan som äger `data`/`struct` (de är vyer i dess minne), eller null = JS-loopen. */
  kernel: ArtKernel | null;
}

/**
 * SIMD-KÄRNAN (2026-11-28, ägaren: "autoskanningen ska gå fortare, utan att tappa träffsäkerhet").
 * Mätt i drift kostade sökningen ~360 ms per live-poll (7 avtryck) och ~1,9 s per skanning
 * (4 rutor × 7), på webbserverns enda tråd — pollarna och skanningen köade bakom varandra. Kärnan
 * (art-kernel.wat) räknar samma heltalsskalärprodukter 16 byte i taget: mätt lokalt mot 43 000 kort
 * 274 → 20 ms (7 avtryck) och 921 → 68 ms (28), med IDENTISKA topplistor och poäng.
 *
 * ⛔ Kärnan räknar bara heltal; normalisering, blandning och topplista är samma JS-aritmetik i
 *    samma ordning som `searchOne` ⇒ bit för bit samma svar (art-index-kernel.test.ts).
 * ⛔ Indexet LIGGER i kärnans minne (inga kopior — minne är Railway-notan). Minnet växer aldrig
 *    efter att vyerna skapats: `grow` kopplar loss alla vyer.
 * Går kärnan inte att starta (ingen SIMD, `ART_INDEX_KERNEL=0`) används JS-loopen som förut.
 */
interface ArtKernel {
  dots: (
    data: number,
    struct: number,
    row: number,
    count: number,
    q: number,
    nq: number,
    out: number,
    fb: number,
    sd: number,
    sg: number
  ) => void;
  /** Frågeblocket: KERNEL_MAX_QUERIES × (färg + struktur). */
  queries: Int8Array;
  /** Skalärprodukterna: per (fråga, rad) tre i32 — färg, DCT, gradient. */
  out: Int32Array;
  queriesOff: number;
  outOff: number;
  dataOff: number;
  structOff: number;
}

/** Frågor per genomgång. En skanning skickar högst 4 rutor × 8 avtryck. */
const KERNEL_MAX_QUERIES = 32;
/** Rader per kärnanrop — utdatat (32 × 256 × 12 byte) ska rymmas i cachen. */
const KERNEL_CHUNK = 256;
const QUERY_BYTES = FINGERPRINT_BYTES + STRUCT_BYTES;

let kernelModule: WebAssembly.Module | null | undefined;
let kernelWarned = false;

/** Indexets två stora fält — i kärnans minne när den finns, annars vanliga arrayer. */
function allocStore(cap: number): { data: Int8Array; struct: Int8Array; kernel: ArtKernel | null } {
  if (process.env.ART_INDEX_KERNEL !== "0" && kernelModule !== null) {
    try {
      kernelModule ??= new WebAssembly.Module(Buffer.from(ART_KERNEL_WASM_BASE64, "base64"));
      const exports = new WebAssembly.Instance(kernelModule).exports as unknown as {
        mem: WebAssembly.Memory;
        dots: ArtKernel["dots"];
      };
      const align = (n: number) => (n + 15) & ~15;
      const queriesOff = 0;
      const outOff = align(KERNEL_MAX_QUERIES * QUERY_BYTES);
      const dataOff = align(outOff + KERNEL_MAX_QUERIES * KERNEL_CHUNK * 12);
      const structOff = align(dataOff + cap * FINGERPRINT_BYTES);
      const total = structOff + cap * STRUCT_BYTES;
      const pages = Math.ceil(total / 65536);
      // Modulen startar på en sida. ⛔ Väx FÖRE vyerna — efteråt aldrig.
      if (pages > 1) exports.mem.grow(pages - 1);
      const buf = exports.mem.buffer;
      return {
        data: new Int8Array(buf, dataOff, cap * FINGERPRINT_BYTES),
        struct: new Int8Array(buf, structOff, cap * STRUCT_BYTES),
        kernel: {
          dots: exports.dots,
          queries: new Int8Array(buf, queriesOff, KERNEL_MAX_QUERIES * QUERY_BYTES),
          out: new Int32Array(buf, outOff, KERNEL_MAX_QUERIES * KERNEL_CHUNK * 3),
          queriesOff,
          outOff,
          dataOff,
          structOff,
        },
      };
    } catch (err) {
      // Ett kompileringsfel gäller hela processen; ett minnesfel (för stort index) prövas om vid nästa laddning.
      if (!(err instanceof RangeError)) kernelModule = null;
      if (!kernelWarned) {
        kernelWarned = true;
        console.warn("[art-index] SIMD-kärnan gick inte att starta — JS-loopen används:", (err as Error).message);
      }
    }
  }
  return {
    data: new Int8Array(cap * FINGERPRINT_BYTES),
    struct: new Int8Array(cap * STRUCT_BYTES),
    kernel: null,
  };
}

/** Fråga: färgavtryck + ev. strukturavtryck (äldre klienter skickar bara färg). */
export interface ArtQuery {
  color: Int8Array;
  struct: Int8Array | null;
}

let cache: ArtIndex | null = null;
let loading: Promise<ArtIndex | null> | null = null;

/**
 * ⛔ SIDVIS, ALDRIG EN FRÅGA (2026-09-28). En enda findMany över alla ~36 000 kort
 * lade +243 MB på processen, och glibc lämnar aldrig tillbaka det — mätt mot prod:
 * en fråga +243 MB, sidor om 2 000 +73 MB, om 500 +49 MB (indexet självt är en
 * bråkdel av det). Varje process laddade det vid första skanningen, och med
 * minnesvaktens omstart var 1–2:e timme betalades toppen om och om igen — den var
 * den största enskilda posten på Railway-notan.
 */
const LOAD_PAGE = 1000;

async function load(): Promise<ArtIndex | null> {
  // Omtryck med samma konst + nummer som originalet hålls utanför — se lib/scanner-exclusion.ts.
  const where: Prisma.CardWhereInput = { AND: [{ artFingerprint: { not: null } }, SCANNER_INCLUDED_CARD] };
  const total = await prisma.card.count({ where });
  if (total === 0) return null;

  // Kapacitet med marginal: kort kan tillkomma mellan räkningen och sidorna.
  let cap = total + 256;
  let store = allocStore(cap);
  let data = store.data;
  let invNorm = new Float32Array(cap);
  let struct = store.struct;
  let invDct = new Float32Array(cap);
  let invGrad = new Float32Array(cap);
  const grow = () => {
    cap = Math.ceil(cap * 1.25);
    const next = allocStore(cap);
    next.data.set(data);
    next.struct.set(struct);
    store = next;
    data = next.data;
    struct = next.struct;
    const widen = (old: Float32Array) => {
      const a = new Float32Array(cap);
      a.set(old);
      return a;
    };
    invNorm = widen(invNorm);
    invDct = widen(invDct);
    invGrad = widen(invGrad);
  };

  const ids: string[] = [];
  let n = 0;
  let missingStruct = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.card.findMany({
      where,
      select: { id: true, artFingerprint: true, structFingerprint: true },
      orderBy: { id: "asc" },
      take: LOAD_PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const row of rows) {
      if (n >= cap) grow();
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
    if (rows.length < LOAD_PAGE) break;
  }
  if (n === 0) return null;
  if (missingStruct > 0) {
    console.warn(
      `[art-index] ${missingStruct} kort saknar strukturavtryck — kör build-art-fingerprints.ts`
    );
  }
  return {
    ids: ids.slice(0, n),
    data,
    invNorm,
    struct,
    invDct,
    invGrad,
    loadedAt: Date.now(),
    kernel: store.kernel,
  };
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

interface PreparedQuery {
  color: Int8Array;
  qInv: number;
  struct: Int8Array | null;
  qInvDct: number;
  qInvGrad: number;
  k: number;
}

/** Frågans normer, en gång. `null` = ogiltig längd eller jämn yta (ingen information). */
function prepareQuery(query: ArtQuery, k: number): PreparedQuery | null {
  if (query.color.length !== FINGERPRINT_BYTES) return null;
  const color = query.color;
  let qNorm = 0;
  for (let i = 0; i < FINGERPRINT_BYTES; i++) qNorm += color[i] * color[i];
  if (qNorm === 0) return null;
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
  return { color, qInv: 1 / Math.sqrt(qNorm), struct, qInvDct, qInvGrad, k };
}

/**
 * (Historik 2026-11-21, se searchOne:) ALLA frågor i EN genomgång av indexet prövades. En skanning skickar upp till 3 rutor × 4
 * inset = 12 avtryck, och varje avtryck var förut en egen genomgång av hela indexet (~43 000 kort ×
 * 1 223 byte): mätt ~380 ms styck, ~4,5 s för en skanning lokalt — och skannerns "match"-fas var
 * 1,9 s i median i drift, större än motorn. Här läses varje indexrad EN gång (den ligger kvar i
 * L1-cachen medan alla frågor räknas mot den), och indexets fält ligger i lokala variabler i stället
 * för att slås upp på objektet i den innersta loopen.
 * ⛔ Samma aritmetik i samma ordning som förut ⇒ samma poäng och samma topplistor, bit för bit
 *    (vaktat i art-index-fused.test.ts). Ändra blandningen HÄR, en gång.
 */
function searchPrepared(index: ArtIndex, queries: PreparedQuery[]): ArtMatch[][] {
  const kernel = index.kernel;
  if (!kernel) return queries.map((Q) => searchOne(index, Q));
  try {
    const results: ArtMatch[][] = [];
    for (let at = 0; at < queries.length; at += KERNEL_MAX_QUERIES) {
      for (const res of searchKernel(index, kernel, queries.slice(at, at + KERNEL_MAX_QUERIES))) results.push(res);
    }
    return results;
  } catch (err) {
    // En skanning får aldrig falla på kärnan: `data`/`struct` är läsbara vyer oavsett, så JS-loopen
    // ger samma svar. Kärnan stängs av för det här indexet och felet syns i loggen.
    index.kernel = null;
    console.error("[art-index] SIMD-kärnan kastade — JS-loopen tar över:", (err as Error).message);
    return queries.map((Q) => searchOne(index, Q));
  }
}

/**
 * Upp till KERNEL_MAX_QUERIES frågor i EN genomgång av indexet: kärnan räknar de tre skalär-
 * produkterna per (fråga, rad) för ett block rader, och poängen + topplistan räknas här.
 * ⛔ Samma uttryck, samma ordning och samma topplistelogik som `searchOne` — ändra dem TILLSAMMANS.
 *    Raderna gås i stigande ordning per fråga, så även lika poäng hamnar som i `searchOne`.
 * Synkron hela vägen: frågeblocket och utdatat delas av alla sökningar mot samma index.
 */
function searchKernel(index: ArtIndex, kernel: ArtKernel, queries: PreparedQuery[]): ArtMatch[][] {
  const { ids, invNorm, invDct, invGrad } = index;
  const BC = BLEND_COLOR;
  const BD = BLEND_DCT;
  const BG = BLEND_GRAD;
  const n = ids.length;
  const nq = queries.length;
  const out = kernel.out;
  for (let qi = 0; qi < nq; qi++) {
    const Q = queries[qi];
    kernel.queries.set(Q.color, qi * QUERY_BYTES);
    // Fråga utan struktur: nollor i blocket (det återanvänds), och poängen tar färggrenen nedan.
    if (Q.struct) kernel.queries.set(Q.struct, qi * QUERY_BYTES + FINGERPRINT_BYTES);
    else kernel.queries.fill(0, qi * QUERY_BYTES + FINGERPRINT_BYTES, (qi + 1) * QUERY_BYTES);
  }
  const tops: ArtMatch[][] = queries.map(() => []);
  const worsts = queries.map(() => -Infinity);
  for (let row = 0; row < n; row += KERNEL_CHUNK) {
    const count = Math.min(KERNEL_CHUNK, n - row);
    kernel.dots(
      kernel.dataOff,
      kernel.structOff,
      row,
      count,
      kernel.queriesOff,
      nq,
      kernel.outOff,
      FINGERPRINT_BYTES,
      STRUCT_DCT_DIMS,
      STRUCT_BYTES - STRUCT_DCT_DIMS
    );
    for (let qi = 0; qi < nq; qi++) {
      const Q = queries[qi];
      const hasStruct = Q.struct !== null;
      const qInv = Q.qInv;
      const qInvDct = Q.qInvDct;
      const qInvGrad = Q.qInvGrad;
      const k = Q.k;
      const top = tops[qi];
      let worst = worsts[qi];
      let o = qi * count * 3;
      for (let j = 0; j < count; j++, o += 3) {
        const r = row + j;
        const cosColor = out[o] * qInv * invNorm[r];
        const score = hasStruct
          ? BC * cosColor + BD * out[o + 1] * qInvDct * invDct[r] + BG * out[o + 2] * qInvGrad * invGrad[r]
          : cosColor;
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
        for (let x = k - 1; x > 0 && top[x].score > top[x - 1].score; x--) {
          const t = top[x];
          top[x] = top[x - 1];
          top[x - 1] = t;
        }
        worst = top[k - 1].score;
      }
      worsts[qi] = worst;
    }
  }
  for (let qi = 0; qi < nq; qi++) {
    if (tops[qi].length < queries[qi].k) tops[qi].sort((a, b) => b.score - a.score);
  }
  return tops;
}

/**
 * EN fråga, en tät genomgång. ⛔ Håll loopen monomorf och platt: en "alla frågor per indexrad"-
 * variant (2026-11-21) var 10× snabbare under tsx men LÅNGSAMMARE i produktionsbygget (live-pollen
 * 355 → ~500 ms i median) — webpack inlinar redan konstanterna, och den nästlade loopen kostade mer
 * än den sparade. Mät i drift (Railways http-logg för /api/scanner/identify-art), inte bara lokalt.
 */
function searchOne(index: ArtIndex, Q: PreparedQuery): ArtMatch[] {
  const { ids, data, invNorm, struct: sData, invDct, invGrad } = index;
  // Importerade konstanter kan bli egenskapsläsningar i transpilerad kod — lokala kopior.
  const FB = FINGERPRINT_BYTES;
  const SB = STRUCT_BYTES;
  const SD = STRUCT_DCT_DIMS;
  const BC = BLEND_COLOR;
  const BD = BLEND_DCT;
  const BG = BLEND_GRAD;
  const n = ids.length;
  const color = Q.color;
  const struct = Q.struct;
  const qInv = Q.qInv;
  const qInvDct = Q.qInvDct;
  const qInvGrad = Q.qInvGrad;
  const k = Q.k;
  const top: ArtMatch[] = [];
  let worst = -Infinity;
  for (let r = 0; r < n; r++) {
    const base = r * FB;
    let dot = 0;
    for (let i = 0; i < FB; i++) dot += color[i] * data[base + i];
    const cosColor = dot * qInv * invNorm[r];
    let score: number;
    if (struct) {
      const sBase = r * SB;
      let dDct = 0;
      for (let i = 0; i < SD; i++) dDct += struct[i] * sData[sBase + i];
      let dGrad = 0;
      for (let i = SD; i < SB; i++) dGrad += struct[i] * sData[sBase + i];
      score = BC * cosColor + BD * dDct * qInvDct * invDct[r] + BG * dGrad * qInvGrad * invGrad[r];
    } else {
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

type TestIndex = Pick<ArtIndex, "ids" | "data" | "invNorm" | "struct" | "invDct" | "invGrad">;

/** Det LADDADE indexet genom sin egen väg (kärnan när den finns) — för scripts/art-kernel-verify.ts. */
export function searchLoadedIndex(
  index: NonNullable<Awaited<ReturnType<typeof getArtIndex>>>,
  queries: { query: ArtQuery; k: number }[]
): ArtMatch[][] {
  const prepared = queries.map((q) => prepareQuery(q.query, q.k));
  const valid = prepared.filter((p): p is PreparedQuery => p !== null);
  const results = valid.length ? searchPrepared(index, valid) : [];
  let v = 0;
  return prepared.map((p) => (p === null ? [] : results[v++]));
}

/**
 * Ren ingång för testet: frågor mot ett givet index (ingen DB). `engine: "kernel"` lägger indexet
 * i SIMD-kärnans minne (kastar om kärnan inte går att starta — testet ska då falla, inte tyst
 * jämföra JS mot JS); `"js"` (standard) kör JS-loopen.
 */
export function searchIndexForTest(
  index: TestIndex,
  queries: { query: ArtQuery; k: number }[],
  engine: "js" | "kernel" = "js"
): ArtMatch[][] {
  const prepared = queries.map((q) => prepareQuery(q.query, q.k));
  const valid = prepared.filter((p): p is PreparedQuery => p !== null);
  let target: ArtIndex = { ...index, loadedAt: 0, kernel: null };
  if (engine === "kernel") {
    const n = index.ids.length;
    const store = allocStore(n);
    if (!store.kernel) throw new Error("SIMD-kärnan gick inte att starta");
    store.data.set(index.data.subarray(0, n * FINGERPRINT_BYTES));
    store.struct.set(index.struct.subarray(0, n * STRUCT_BYTES));
    target = { ...target, data: store.data, struct: store.struct, kernel: store.kernel };
  }
  const results = valid.length ? searchPrepared(target, valid) : [];
  let v = 0;
  return prepared.map((p) => (p === null ? [] : results[v++]));
}

/** Flera frågor, var och en med sitt k, i en genomgång. Ogiltiga frågor ger []. */
async function searchMany(queries: { query: ArtQuery; k: number }[]): Promise<ArtMatch[][]> {
  if (queries.length === 0) return [];
  const index = await getArtIndex();
  if (!index) return queries.map(() => []);
  const prepared = queries.map((q) => prepareQuery(q.query, q.k));
  const valid = prepared.filter((p): p is PreparedQuery => p !== null);
  const results = valid.length ? searchPrepared(index, valid) : [];
  let v = 0;
  return prepared.map((p) => (p === null ? [] : results[v++]));
}

/** Inset-svepets sammanslagning: varje korts BÄSTA likhet över varianterna (se searchByFingerprints). */
function mergeVariants(perVariant: ArtMatch[][], k: number): ArtMatch[] {
  const best = new Map<string, number>();
  for (const res of perVariant) {
    for (const m of res) {
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
  return (await searchMany([{ query, k }]))[0];
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
  if (fingerprints.length === 1) return (await searchMany([{ query: fingerprints[0], k }]))[0];
  // Hämta djupare än k per variant: rätt kort kan ligga strax utanför k i en
  // felbeskuren variant men överst i den rätta, och då ska det ändå med.
  return mergeVariants(await searchMany(fingerprints.map((query) => ({ query, k: k * 2 }))), k);
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
export async function searchByFrames(
  frames: ArtQuery[][],
  k = 15
): Promise<ArtMatch[]> {
  return (await searchByFramesDetailed(frames, k)).best;
}

/**
 * Som `searchByFrames`, men returnerar också VARJE rutas topp-1. Rutorna är
 * oberoende observationer (egen moiré, egen skakning, egen fokus) — att alla
 * pekar på SAMMA kort är temporalt bevis av samma slag som live-låsets "tre
 * pollar i rad", och används av den utvidgade trust-regeln (se
 * ART_AGREE_MARGIN i scanner/index.ts).
 */
export async function searchByFramesDetailed(
  frames: ArtQuery[][],
  k = 15
): Promise<{ best: ArtMatch[]; frameTops: ArtMatch[] }> {
  const usable = frames.filter((f) => f.length > 0);
  if (usable.length === 0) return { best: [], frameTops: [] };
  // ALLA rutors alla inset-varianter i EN genomgång av indexet (searchPrepared) — samma svar som
  // searchByFingerprints per ruta, utan en genomgång per avtryck.
  const flat = usable.flatMap((frame) =>
    frame.map((query) => ({ query, k: frame.length === 1 ? k : k * 2 }))
  );
  const all = await searchMany(flat);
  let at = 0;
  const perFrame = usable.map((frame) => {
    const slice = all.slice(at, (at += frame.length));
    return frame.length === 1 ? slice[0] : mergeVariants(slice, k);
  });
  if (perFrame.length === 1) {
    const res = perFrame[0];
    return { best: res, frameTops: res.length > 0 ? [res[0]] : [] };
  }

  let best: ArtMatch[] = [];
  let bestMargin = -Infinity;
  const frameTops: ArtMatch[] = [];
  for (const res of perFrame) {
    if (res.length === 0) continue;
    frameTops.push(res[0]);
    // Ensam träff = odefinierad marginal. Behandla som minst avgörande, men
    // behåll den som reserv om ingen annan ruta gav något.
    const margin = res.length >= 2 ? res[0].score - res[1].score : 0;
    if (margin > bestMargin) {
      bestMargin = margin;
      best = res;
    }
  }
  return { best, frameTops };
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
export async function artPairSimilarity(
  a: string,
  b: string
): Promise<number | null> {
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

/**
 * Ett korts REFERENS-färgavtryck (katalogrenderingen), eller null när kortet
 * saknas i indexet. Läses ur det redan laddade indexet — ingen Neon-läsning.
 *
 * Används av folie-instrumenteringen: hela poängen där är att jämföra fångsten
 * mot DET HÄR kortets kända platta rendering, inte mot en generell modell.
 */
export async function getCardColorFingerprint(
  cardId: string
): Promise<Int8Array | null> {
  const index = await getArtIndex();
  if (!index) return null;
  const row = index.ids.indexOf(cardId);
  if (row < 0) return null;
  return index.data.slice(
    row * FINGERPRINT_BYTES,
    (row + 1) * FINGERPRINT_BYTES
  );
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
