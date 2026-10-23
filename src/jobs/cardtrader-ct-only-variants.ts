/**
 * VARIANTER SOM BARA FINNS HOS CARDTRADER (2026-10-23, användarönskemål).
 *
 * Pokémon GO-setets "Peelable Ditto" (Spinarak 006, Numel 013, Bidoof 059 med ett
 * Ditto-klistermärke ovanpå) har ingen Cardmarket-produkt och ingen rad hos vår
 * prisleverantör — CardTrader har dem som egna blueprints med en riktig marknad
 * (23–38 annonser, mätt 2026-10-23). De blir egna katalogposter med etiketten
 * `VARIANT_PEELABLE_DITTO`, prissatta av CardTraders lägsta NM-engelska annons.
 *
 * ⛔ KURERAD LISTA, INGEN AUTOMATIK: varje rad är en blueprint vi har tittat på. En
 * namnbaserad sökning över CT:s katalog hade fött varianter vi inte vet om de finns.
 * ⛔ Kortet identifieras på SET + SAMLARNUMMER + NAMN (blueprintens namn måste vara
 * vårt kortnamn) — numret ensamt är aldrig identitet.
 * ⛔ Inget pris under CT_MIN_DEPTH annonser: ett golv av EN annons är ett utrop.
 */
import { prisma } from "../lib/db";
import { getRatesOre } from "../lib/exchange-rate";
import { normalizeTitle } from "../lib/utils";
import { VARIANT_PEELABLE_DITTO } from "../lib/print-variant";
import { CT_MIN_DEPTH, ctBlueprintUrl, ctGet, isBuyableNmEnListing, type CtListing } from "../lib/cardtrader";
import { createObservationWriter } from "./cardtrader-observation";

export interface CtOnlyVariant {
  blueprintId: number;
  /** Vårt set (namn, engelska) + samlarnummer + kortnamn — alla tre måste stämma. */
  setName: string;
  number: string;
  cardName: string;
  label: string;
}

export const CT_ONLY_VARIANTS: CtOnlyVariant[] = [
  { blueprintId: 370584, setName: "Pokémon GO", number: "6", cardName: "Spinarak", label: VARIANT_PEELABLE_DITTO },
  { blueprintId: 370583, setName: "Pokémon GO", number: "13", cardName: "Numel", label: VARIANT_PEELABLE_DITTO },
  { blueprintId: 370580, setName: "Pokémon GO", number: "59", cardName: "Bidoof", label: VARIANT_PEELABLE_DITTO },
];

/** Lägsta köpbara NM-engelska annonsen i eurocent, eller null under djupgränsen. */
export function ctOnlyFloorCents(listings: CtListing[] | undefined): number | null {
  const ok = (listings ?? []).filter(isBuyableNmEnListing).map((l) => l.price.cents).sort((a, b) => a - b);
  return ok.length >= CT_MIN_DEPTH ? ok[0] : null;
}

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function runCtOnlyVariants(opts: { apply: boolean }): Promise<{ priced: number; created: number; skipped: string[] }> {
  const { eurToOre } = await getRatesOre();
  const out = { priced: 0, created: 0, skipped: [] as string[] };
  const retailer = await prisma.retailer.findUnique({ where: { name: "CardTrader" }, select: { id: true } });
  if (!retailer) throw new Error("CardTrader-retailern saknas");
  const obs = await createObservationWriter(opts.apply);

  for (const v of CT_ONLY_VARIANTS) {
    const base = await prisma.product.findFirst({
      where: {
        category: "SINGLE_CARD",
        language: "EN",
        variantLabel: null,
        card: { number: v.number, name: v.cardName, set: { name: v.setName, language: "EN" } },
      },
      select: { id: true, slug: true, title: true, cardId: true, setId: true, imageUrl: true, description: true, releaseDate: true },
    });
    if (!base?.cardId) {
      out.skipped.push(`${v.cardName} ${v.number}: baskortet saknas`);
      continue;
    }
    const market = await ctGet<Record<string, CtListing[]>>(`/marketplace/products?blueprint_id=${v.blueprintId}`);
    const cents = ctOnlyFloorCents(market[String(v.blueprintId)]);
    if (cents == null) {
      out.skipped.push(`${v.cardName} ${v.number}: under ${CT_MIN_DEPTH} NM-engelska annonser`);
      continue;
    }
    const priceOre = Math.round((cents / 100) * eurToOre);
    if (!opts.apply) {
      out.priced++;
      console.log(`[ct-only] ${base.title} · ${v.label}: ${(cents / 100).toFixed(2)} € (torrkörning)`);
      continue;
    }
    const slug = `${base.slug}-${slugify(v.label)}`;
    const title = `${base.title} · ${v.label}`;
    const existed = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    const product =
      existed ??
      (await prisma.product.create({
        data: {
          title, normalizedTitle: normalizeTitle(title), slug, category: "SINGLE_CARD", variantLabel: v.label,
          cardId: base.cardId, setId: base.setId, imageUrl: base.imageUrl, description: base.description,
          releaseDate: base.releaseDate, language: "EN",
        },
        select: { id: true },
      }));
    if (!existed) out.created++;
    await prisma.offer.upsert({
      where: { productId_retailerId_condition_language: { productId: product.id, retailerId: retailer.id, condition: "NEAR_MINT", language: "EN" } },
      update: { price: priceOre, currency: "SEK", stockStatus: "IN_STOCK", url: ctBlueprintUrl(v.blueprintId), lastSeenAt: new Date() },
      create: {
        productId: product.id, retailerId: retailer.id, condition: "NEAR_MINT", language: "EN", price: priceOre,
        currency: "SEK", stockStatus: "IN_STOCK", url: ctBlueprintUrl(v.blueprintId),
      },
      select: { id: true },
    });
    await obs.record(product.id, priceOre);
    out.priced++;
    console.log(`[ct-only] ${title}: ${(cents / 100).toFixed(2)} € = ${(priceOre / 100).toFixed(2)} kr`);
  }
  return out;
}
