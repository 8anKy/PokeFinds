/**
 * Graderingens tillägg (2026-10-01): användarens UPPMÄTTA centrering och
 * "Lönar det sig att gradera?" — båda utanför modellanropet.
 */
import { z } from "zod";
import { psaCapFor, type CenteringSide } from "@/lib/centering";
import { loadGradedForSlug } from "@/services/products";
import { estimateCardValue } from "@/services/scanner";

/** En sidas mätning. Talen är den BREDARE sidans andel per axel, 50..100. */
const share = z.number().min(50).max(100);
const corner = z.object({ x: z.number().min(-0.25).max(1.25), y: z.number().min(-0.25).max(1.25) });
const sideSchema = z.object({
  mode: z.enum(["standard", "ereader"]),
  leftRight: share.optional(),
  topBottom: share.optional(),
  topRight: share.optional(),
  /**
   * Kortets fyra hörn i FOTOT (andelar, medsols från övre vänster) — kortets kant
   * så som användaren lade den i mätaren (2026-10-04). Sparas så att slabbens "Mitt
   * foto" kan skära ut exakt kortet även ur en sparad gradering.
   */
  cardQuad: z.array(corner).length(4).optional(),
});
export const centeringInputSchema = z
  .object({ front: sideSchema.optional(), back: sideSchema.optional() })
  .optional();
export type CenteringInput = z.infer<typeof centeringInputSchema>;
type SideInput = z.infer<typeof sideSchema>;

const ratio = (wide: number) => {
  const big = Math.round(wide);
  return `${big}/${100 - big}`;
};

function sideNote(side: CenteringSide, s: SideInput): string | null {
  const name = side === "front" ? "framsida" : "baksida";
  if (side === "front" && s.mode === "ereader" && s.topRight != null) {
    return `${name} (e-Reader, punktkod längs vänster/nederkant) övre/höger ${ratio(s.topRight)}`;
  }
  const parts: string[] = [];
  if (s.leftRight != null) parts.push(`V/H ${ratio(s.leftRight)}`);
  if (s.topBottom != null) parts.push(`Ö/N ${ratio(s.topBottom)}`);
  return parts.length ? `${name} ${parts.join(", ")}` : null;
}

function sideCap(side: CenteringSide, s: SideInput): number | null {
  const shares = side === "front" && s.mode === "ereader"
    ? [s.topRight]
    : [s.leftRight, s.topBottom];
  const known = shares.filter((v): v is number => v != null);
  if (known.length !== shares.length || known.length === 0) return null;
  return psaCapFor(Math.max(...known), side);
}

export interface StoredCentering {
  front: SideInput | null;
  back: SideInput | null;
  /** Texten modellen fick. */
  note: string;
  /** Strängaste PSA-taket av fram/bak. */
  psaCap: number | null;
}

/** Mätningen i den form modellen och historiken behöver. null = ingen mätning. */
export function centeringFromInput(input: CenteringInput): StoredCentering | null {
  if (!input) return null;
  const notes: string[] = [];
  const caps: number[] = [];
  for (const side of ["front", "back"] as const) {
    const s = input[side];
    if (!s) continue;
    const n = sideNote(side, s);
    if (n) notes.push(n);
    const c = sideCap(side, s);
    if (c != null) caps.push(c);
  }
  if (notes.length === 0) return null;
  return {
    front: input.front ?? null,
    back: input.back ?? null,
    note: notes.join("; "),
    psaCap: caps.length ? Math.min(...caps) : null,
  };
}

/** En PSA-rad i "Lönar det sig?". */
export interface WorthRow {
  gradeTenths: number;
  /** Median ur sålda (eBay före Tradera — störst urval), öre. null = låst (gratis). */
  medianOre: number | null;
  count: number;
  source: "ebay" | "tradera";
}

export interface GradingWorth {
  slug: string;
  /** Ograderat marknadsvärde (Cardmarket först, samma som samlingen). */
  rawOre: number | null;
  /** PSA-betyg runt den uppskattade graden. Tom = inga sålda graderade alls. */
  rows: WorthRow[];
  /** Gratis: raderna finns men talen är Pro (samma grind som produktsidan). */
  locked: boolean;
}

/**
 * Vilka PSA-betyg som är intressanta för en uppskattad grad: golvet och steget
 * över (8,5 ⇒ PSA 8 och 9), alltid med PSA 10 när graden är ≥ 9.
 */
export function worthGrades(overall: number): number[] {
  const lo = Math.max(1, Math.min(10, Math.floor(overall)));
  const set = new Set([lo, Math.min(10, lo + 1)]);
  if (overall >= 9) set.add(10);
  return [...set].sort((a, b) => b - a);
}

/**
 * "LÖNAR DET SIG ATT GRADERA?" — ograderat värde mot sålda PSA-exemplar.
 * ⛔ Aldrig en uträknad vinst: graderingsavgift och frakt varierar och vi har inga
 *    verifierade tal — användaren ser underlaget (median + antal), inte en slutsats.
 * ⛔ Graderade priser är Pro (ägarbeslut 2026-09-17) — gratis får antalet och
 *    betygen, aldrig talen.
 */
export async function gradingWorth(
  cardId: string | null | undefined,
  slug: string | null | undefined,
  overall: number,
  isPro: boolean
): Promise<GradingWorth | null> {
  if (!cardId || !slug) return null;
  const [rawOre, graded] = await Promise.all([
    estimateCardValue(cardId).catch(() => null),
    loadGradedForSlug(slug).catch(() => null),
  ]);
  const wanted = worthGrades(overall);
  const rows: WorthRow[] = [];
  for (const g of wanted) {
    const tenths = g * 10;
    const pick = (source: "ebay" | "tradera") =>
      graded?.rows.find((r) => r.issuer === "PSA" && r.gradeTenths === tenths && r.source === source);
    const best = pick("ebay") ?? pick("tradera");
    if (!best) continue;
    rows.push({
      gradeTenths: tenths,
      medianOre: isPro ? best.medianOre : null,
      count: best.count,
      source: best.source,
    });
  }
  if (rawOre == null && rows.length === 0) return null;
  return { slug, rawOre, rows, locked: !isPro && rows.length > 0 };
}
