/**
 * EGEN TEXTMODELL FÖR TRADERA-KONTROLLEN (2026-10-14, ägarbeslut: "ingen AI", samma linje som skannerns
 * egen bildmodell). Avgör om en Tradera-annons är den förseglade katalogprodukten — det LLM-domen gjorde.
 *
 * Logistisk regression över hashade särdrag, tränad på ~3 100 sparade LLM-domar
 * (`scripts/train-tradera-listing-model.ts`). Ingen extern tjänst, inget nätverk; vikterna ligger i
 * repot (`src/data/tradera-listing-model.json`) och modellen körs i det nattliga Actions-jobbet.
 *
 * ⛔ EN ENDA implementation av särdragen: tränaren importerar `listingFeatures` härifrån. Två kopior
 * hade glidit isär och modellen hade tyst sett andra särdrag i drift än i träningen.
 */
import { sealedListingProblem } from "@/lib/tradera-sealed-rules";
import { listingProductProblem, listingWholeProblem } from "@/lib/tradera-listing-rules";
import { characterNames } from "@/scrapers/matching";

export const FEATURE_BITS = 18;
const DIM = 1 << FEATURE_BITS;

export interface ListingExample {
  catalogTitle: string;
  catalogCategory: string;
  /** Katalogpostens språk (EN/JP) — en japansk produkt måste säga sig vara japansk i annonsen. */
  catalogLanguage?: string | null;
  listingTitle: string;
  description: string | null | undefined;
}

/** FNV-1a 32-bit — deterministisk, samma i träning och drift. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % DIM;
}

export function cleanText(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&quot;|&#\d+;/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["pokemon", "pokémon", "tcg", "the", "och", "och", "og", "and", "med", "with", "från", "fra", "of", "-"]);
const words = (s: string) => s.split(" ").filter((w) => w && !STOP.has(w));

/** Hashade särdrag med vikt (räknas, inte bara närvaro, men dämpat). */
export function listingFeatures(ex: ListingExample): Map<number, number> {
  const f = new Map<number, number>();
  const add = (k: string, v = 1) => {
    const i = hash(k);
    f.set(i, (f.get(i) ?? 0) + v);
  };
  const cat = cleanText(ex.catalogTitle);
  const title = cleanText(ex.listingTitle);
  const desc = cleanText(ex.description).slice(0, 2000);
  const cw = new Set(words(cat));
  const tw = words(title);
  const dw = words(desc);

  add("bias");
  add(`c:${ex.catalogCategory}`);
  // Annonsens titel: ord + ordpar, och samma ord villkorade på katalogens kategori.
  for (let i = 0; i < tw.length; i++) {
    add(`t:${tw[i]}`);
    add(`ct:${ex.catalogCategory}|${tw[i]}`);
    if (i + 1 < tw.length) add(`tb:${tw[i]} ${tw[i + 1]}`);
  }
  // Beskrivningen: ord + ordpar (dämpat — den är lång och full av fraktinformation).
  for (let i = 0; i < dw.length; i++) {
    add(`d:${dw[i]}`, 0.3);
    if (i + 1 < dw.length) add(`db:${dw[i]} ${dw[i + 1]}`, 0.3);
  }
  // Tecken-trigram över titel + beskrivningens början: tål stavfel och trasig teckenkodning.
  const chunk = ` ${title} ${desc.slice(0, 400)} `;
  for (let i = 0; i + 4 <= chunk.length; i++) add(`g:${chunk.slice(i, i + 4)}`, 0.15);
  // KORSSÄRDRAG: vad annonsen har som katalogen saknar, och tvärtom. Det är så AI:n såg
  // "Gallade & Goomy" mot "Gallade" eller "Premium Collection" mot "Box".
  const tset = new Set(tw);
  for (const w of tset) if (!cw.has(w)) add(`x:${w}`);
  for (const w of cw) if (!tset.has(w)) add(`m:${w}`);
  // Reglerna som särdrag — modellen lär sig hur mycket de ska väga.
  const sealed = sealedListingProblem(ex.listingTitle, ex.description);
  if (sealed) add(`r:sealed:${sealed.split(" (")[0]}`, 2);
  const product = listingProductProblem(ex.catalogTitle, ex.catalogCategory, ex.listingTitle);
  if (product) add(`r:product:${product.split(" (")[0].split(" ≠")[0]}`, 2);
  const whole = listingWholeProblem(ex.catalogTitle, ex.catalogCategory, ex.listingTitle, ex.description, characterNames, ex.catalogLanguage);
  if (whole) add(`r:whole:${whole.split(" (")[0].split(" ≠")[0]}`, 2);
  // Antal paket i BESKRIVNINGEN ("Fyra oöppnade boosterpaket", "4 stk … packs") mot ett enskilt pack.
  if (ex.catalogCategory === "BOOSTER_PACK" && /(?:^|\s)(?:[2-9]|[1-9]\d|två|tre|fyra|fem|sex|to|fire|seks|two|three|four|five)\s+(?:st\s+|stk\s+|stycken\s+)?(?:oöppnade\s+|o ppnade\s+|nya\s+|forseglede\s+)?(?:booster|boosterpaket|boosterpakker|paket|packs|pakker)/iu.test(desc)) {
    add("r:desc-multi", 2);
  }
  return f;
}

export interface ListingModel {
  v: number;
  bits: number;
  /** Sannolikhet för "OK" under detta ⇒ annonsen fälls. */
  threshold: number;
  /** Glesa vikter: [index, vikt]. */
  weights: [number, number][];
  trainedAt: string;
  metrics?: Record<string, number>;
}

/** P(annonsen är den förseglade katalogprodukten). */
export function predictListingOk(w: Map<number, number>, ex: ListingExample): number {
  let z = 0;
  for (const [i, v] of listingFeatures(ex)) z += (w.get(i) ?? 0) * v;
  return 1 / (1 + Math.exp(-z));
}

export function weightMap(model: ListingModel): Map<number, number> {
  return new Map(model.weights);
}
