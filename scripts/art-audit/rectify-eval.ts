/**
 * RÄTNINGS-RACET (Fas 1) — mäter om quad-detektering + perspektivvarp slår
 * inset-svepet på felinramade fångster, INNAN klienten shippar det.
 *
 * Metodik: samma kalibrerade skärmfoto-degradering som screen-eval.ts
 * (degradeAsScreenPhoto + addScreenArtifacts), men med BAKGRUND RUNT KORTET
 * (pad) som huvudvariabel — det uppmätta produktionsfallet där ett enda
 * avtryck faller från 96 % till 15 % topp-15. Fyra metoder jämförs på SAMMA
 * frågor mot HELA katalogen som distraktorer, poängen är produktionens
 * triw-blandning (0,25·färg + 0,25·dctb + 0,5·grad):
 *
 *   single  — ett avtryck på hela fångsten (inset 0)
 *   sweep   — produktionens inset-svep [0/3/6/9 %], MAX per kort
 *   quad    — detectCardQuad + warpPerspective → ETT avtryck på varpen
 *   both    — sweep + quad-varianten (exakt vad klienten skulle skicka)
 *
 * Referensmatriserna återanvänds från screen-eval:s cache (kör den först).
 *
 *   QUERIES=100 PADS=0.02,0.06,0.10 npx tsx scripts/art-audit/rectify-eval.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { fingerprintFromRgb, toUnitVector } from "../../src/lib/art-fingerprint";
import { detectCardQuad, warpPerspective, RECTIFIED_H, RECTIFIED_W } from "../../src/lib/card-quad";
import { cachePath } from "./cache";
import { PROFILES, degradeAsScreenPhoto } from "./descriptor";
import { addScreenArtifacts, dctSignDescriptor, gradDescriptor } from "./screen-descriptors";

interface Card {
  id: string;
  name: string;
  number: string;
  set: string;
}

const CARDS = process.env.CARDS ?? ".spike/cards.json";
const CACHE = process.env.CACHE ?? ".spike/img-cache";
const REF_DIR = process.env.REF_DIR ?? ".spike/screen-refs";
const REF_VERSION = "v1";
const QUERIES = Number(process.env.QUERIES ?? "100");
const PADS = (process.env.PADS ?? "0.02,0.06,0.10").split(",").map(Number);
const INSETS = [0, 0.03, 0.06, 0.09];
/**
 * ASYM=1: bakgrunden läggs OJÄMNT (kortet ur centrum) + kraftigare rotation
 * (±ROT grader, default 6). Det är rätningens EGENTLIGA målfall: inset-svepet
 * beskär symmetriskt och kan per konstruktion inte träffa ett förskjutet eller
 * roterat kort — medan en symmetrisk pad är exakt det svepet redan löser.
 */
const ASYM = process.env.ASYM === "1";
const ROT = Number(process.env.ROT ?? "6");

const DIMS = { colorgrid: 264, dctb: 255, grad: 704 } as const;
type Kind = keyof typeof DIMS;

function loadRefs(): { ids: string[]; mats: Record<Kind, Float32Array> } {
  const idsPath = join(REF_DIR, `ids-${REF_VERSION}.json`);
  const kinds = Object.keys(DIMS) as Kind[];
  if (!existsSync(idsPath) || kinds.some((k) => !existsSync(join(REF_DIR, `${k}-${REF_VERSION}.bin`)))) {
    throw new Error("referenscache saknas — kör screen-eval.ts först (bygger .spike/screen-refs)");
  }
  const ids: string[] = JSON.parse(readFileSync(idsPath, "utf8"));
  const mats = {} as Record<Kind, Float32Array>;
  for (const k of kinds) {
    const raw = readFileSync(join(REF_DIR, `${k}-${REF_VERSION}.bin`));
    mats[k] = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  }
  return { ids, mats };
}

/** triw-poäng för EN frågevariant mot alla referenser, adderas in i `best` som MAX. */
function scoreVariant(
  refs: { ids: string[]; mats: Record<Kind, Float32Array> },
  q: { colorgrid: Float32Array; dctb: Float32Array; grad: Float32Array },
  best: Float64Array
) {
  const n = refs.ids.length;
  for (let i = 0; i < n; i++) {
    let s = 0;
    let acc = 0;
    const cg = refs.mats.colorgrid;
    for (let j = 0; j < 264; j++) acc += q.colorgrid[j] * cg[i * 264 + j];
    s += 0.25 * acc;
    acc = 0;
    const db = refs.mats.dctb;
    for (let j = 0; j < 255; j++) acc += q.dctb[j] * db[i * 255 + j];
    s += 0.25 * acc;
    acc = 0;
    const gr = refs.mats.grad;
    for (let j = 0; j < 704; j++) acc += q.grad[j] * gr[i * 704 + j];
    s += 0.5 * acc;
    if (s > best[i]) best[i] = s;
  }
}

function descriptorsAt(
  data: Buffer,
  w: number,
  h: number,
  inset: number
): { colorgrid: Float32Array; dctb: Float32Array; grad: Float32Array } | null {
  // Insetet appliceras via beskärningsindex i respektive fn? De harness-fns
  // saknar inset-param — beskär buffern här (boxmedelvärdet är okänsligt för
  // exakt kant, samma aritmetik som produktionens inset i fingerprintFromRgb).
  let px: Buffer | Uint8Array = data;
  let iw = w;
  let ih = h;
  if (inset > 0) {
    const dx = Math.round(w * inset);
    const dy = Math.round(h * inset);
    iw = w - dx * 2;
    ih = h - dy * 2;
    if (iw < 16 || ih < 16) return null;
    const out = new Uint8Array(iw * ih * 3);
    for (let y = 0; y < ih; y++) {
      const src = ((y + dy) * w + dx) * 3;
      out.set(data.subarray(src, src + iw * 3), y * iw * 3);
    }
    px = out;
  }
  const fp = fingerprintFromRgb(px, iw, ih, 3);
  if (!fp) return null;
  return {
    colorgrid: toUnitVector(fp),
    dctb: dctSignDescriptor(px, iw, ih, 3),
    grad: gradDescriptor(px, iw, ih, 3),
  };
}

async function main() {
  const cards: Card[] = JSON.parse(readFileSync(CARDS, "utf8"));
  const refs = loadRefs();
  const idxById = new Map(refs.ids.map((id, i) => [id, i]));
  const available = cards.filter(
    (c) => idxById.has(c.id) && existsSync(cachePath(CACHE, c.id))
  );
  console.log(`katalog i referens: ${refs.ids.length} · frågekandidater: ${available.length}`);

  const stride = Math.max(1, Math.floor(available.length / QUERIES));
  const queryCards: Card[] = [];
  for (let i = 0; i < available.length && queryCards.length < QUERIES; i += stride) {
    queryCards.push(available[i]);
  }

  for (const pad of PADS) {
    const profile = { ...PROFILES.harsh, label: `pad${pad}`, jitter: 0.03, pad };
    const methods = ["single", "sweep", "quad", "both"] as const;
    const stats = Object.fromEntries(
      methods.map((m) => [m, { top1: 0, top5: 0, top15: 0, n: 0 }])
    ) as Record<(typeof methods)[number], { top1: number; top5: number; top15: number; n: number }>;
    let detected = 0;
    let queries = 0;

    for (const [qi, qcard] of queryCards.entries()) {
      // ASYM: pad läggs EFTERÅT (ojämnt + rotation) i stället för profilens
      // symmetriska — profilen får då pad 0 så bakgrunden inte dubbleras.
      const degraded = await degradeAsScreenPhoto(
        readFileSync(cachePath(CACHE, qcard.id)),
        qi + 1,
        ASYM ? { ...profile, pad: 0 } : profile
      );
      if (!degraded) continue;
      let placed = degraded;
      if (ASYM) {
        const rnd = (i: number) => {
          const x = Math.sin((qi + 1) * 9377 + i * 52361) * 43758.5453;
          return x - Math.floor(x);
        };
        try {
          const angle = (rnd(1) - 0.5) * 2 * ROT;
          const bg = { r: 24, g: 20, b: 18 };
          const rotated = await sharp(degraded).rotate(angle, { background: bg }).toBuffer();
          const meta = await sharp(rotated).metadata();
          const rw = meta.width ?? 0;
          const rh = meta.height ?? 0;
          if (!rw || !rh) continue;
          // Total pad = profilens pad-nivå, fördelad ojämnt (0–100 % per sida).
          const padX = Math.round(rw * pad * 2);
          const padY = Math.round(rh * pad * 2);
          const lx = Math.round(padX * rnd(2));
          const ty = Math.round(padY * rnd(3));
          placed = await sharp(rotated)
            .extend({ left: lx, right: padX - lx, top: ty, bottom: padY - ty, background: bg })
            .jpeg({ quality: profile.finalQuality })
            .toBuffer();
        } catch {
          continue;
        }
      }
      const withArtifacts = await addScreenArtifacts(placed, qi + 1);
      if (!withArtifacts) continue;
      let raw: { data: Buffer; info: { width: number; height: number } };
      try {
        raw = await sharp(withArtifacts).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      } catch {
        continue;
      }
      const { width: w, height: h } = raw.info;
      const selfIdx = idxById.get(qcard.id);
      if (selfIdx === undefined) continue;
      queries++;

      // Frågevarianter per metod.
      const variants: Record<(typeof methods)[number], Float64Array> = {
        single: new Float64Array(refs.ids.length).fill(-Infinity),
        sweep: new Float64Array(refs.ids.length).fill(-Infinity),
        quad: new Float64Array(refs.ids.length).fill(-Infinity),
        both: new Float64Array(refs.ids.length).fill(-Infinity),
      };
      const single = descriptorsAt(raw.data, w, h, 0);
      if (single) {
        scoreVariant(refs, single, variants.single);
        scoreVariant(refs, single, variants.both);
      }
      for (const inset of INSETS) {
        const d = inset === 0 ? single : descriptorsAt(raw.data, w, h, inset);
        if (!d) continue;
        scoreVariant(refs, d, variants.sweep);
        if (inset !== 0) scoreVariant(refs, d, variants.both);
      }
      const quad = detectCardQuad(raw.data, w, h, 3);
      if (quad) {
        detected++;
        const warped = warpPerspective(raw.data, w, h, 3, quad.corners);
        if (warped) {
          // Varpen är RGBA (kanal 4) — samma kod som klienten kör.
          const d = (() => {
            const fp = fingerprintFromRgb(warped, RECTIFIED_W, RECTIFIED_H, 4);
            if (!fp) return null;
            // Harness-deskriptorerna tar Uint8Array — samma bytes, annan vy.
            const view = new Uint8Array(warped.buffer, warped.byteOffset, warped.length);
            return {
              colorgrid: toUnitVector(fp),
              dctb: dctSignDescriptor(view, RECTIFIED_W, RECTIFIED_H, 4),
              grad: gradDescriptor(view, RECTIFIED_W, RECTIFIED_H, 4),
            };
          })();
          if (d) {
            scoreVariant(refs, d, variants.quad);
            scoreVariant(refs, d, variants.both);
          }
        }
      }

      for (const m of methods) {
        const scores = variants[m];
        const self = scores[selfIdx];
        if (!Number.isFinite(self)) continue;
        let rank = 0;
        for (let i = 0; i < scores.length; i++) if (scores[i] > self) rank++;
        const st = stats[m];
        st.n++;
        if (rank === 0) st.top1++;
        if (rank < 5) st.top5++;
        if (rank < 15) st.top15++;
      }
    }

    console.log(`\n--- pad ${(pad * 100).toFixed(0)} % (n=${queries}, quad hittad ${detected}/${queries}) ---`);
    for (const m of methods) {
      const st = stats[m];
      const pct = (x: number) => (st.n ? `${((x / st.n) * 100).toFixed(1)}%`.padStart(6) : "     –");
      console.log(
        `[${m.padEnd(6)}] topp-1 ${pct(st.top1)} · topp-5 ${pct(st.top5)} · topp-15 ${pct(st.top15)} (n=${st.n})`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
