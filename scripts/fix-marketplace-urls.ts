/**
 * Skriver om Cardmarket- och Tradera-offer-URL:er så att de pekar på rätt sida:
 *
 * - Cardmarket (singelkort med cardmarket-data i senaste TCG-API-observationen):
 *   exakt engelsk produktlänk — cachad CM-slug (?language=1) om den finns,
 *   annars prices.pokemontcg.io/cardmarket/{id} (redirecten döljs i UI tills
 *   resolve-cm-urls.ts uppgraderat den). Redan lösta slug-länkar rörs inte.
 * - Cardmarket (övriga singelkort): namn-sök (fullständig titel med set+nummer
 *   ger 0 träffar på Cardmarket — endast kortnamnet fungerar).
 * - Cardmarket (sealed): sök på produkttiteln (set-namn + form), den matchar.
 * - Tradera (singelkort): sök på "Pokemon {kortnamn}" — set-namn + nummer i
 *   söktermen ger 0 träffar hos Tradera.
 * - Tradera (sealed): sök på "Pokemon {titel}".
 *
 * Körs med: npx tsx scripts/fix-marketplace-urls.ts
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import {
  cardmarketExactUrl,
  cardmarketSearchUrl,
  traderaSearchUrl,
  traderaSearchUrlSpecific,
} from "./marketplace-urls";
import { isEnglishCardmarketUrl } from "../src/lib/marketplace-urls";

const prisma = new PrismaClient();

const BATCH = 500;

/** Cachade exakta engelska CM-slug-länkar (resolve-cm-urls.ts), tcgId → url. */
const slugCache: Record<string, string> = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), ".cache", "cm-resolved-urls.json"), "utf8")
    );
  } catch {
    return {};
  }
})();

async function main() {
  const [cardmarket, tradera, tcgSource] = await Promise.all([
    prisma.retailer.findFirstOrThrow({ where: { name: "Cardmarket" } }),
    prisma.retailer.findFirstOrThrow({ where: { name: "Tradera" } }),
    prisma.scrapeSource.findFirst({ where: { name: "Pokémon TCG API" } }),
  ]);

  let cmExact = 0;
  let cmSearch = 0;
  let trFixed = 0;
  let cursor: string | undefined;

  while (true) {
    const products = await prisma.product.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        title: true,
        category: true,
        card: { select: { id: true, name: true, number: true, tcgExternalId: true, set: { select: { name: true } } } },
        offers: {
          where: { retailerId: { in: [cardmarket.id, tradera.id] } },
          select: { id: true, retailerId: true, url: true },
        },
      },
    });
    if (products.length === 0) break;
    cursor = products[products.length - 1].id;

    // Vilka produkter i batchen har cardmarket-data i senaste observationen?
    const singleIds = products
      .filter((p) => p.category === "SINGLE_CARD")
      .map((p) => p.id);
    const hasCardmarketData = new Set<string>();
    if (tcgSource && singleIds.length > 0) {
      const obs = await prisma.priceObservation.findMany({
        where: { productId: { in: singleIds }, sourceId: tcgSource.id },
        orderBy: { observedAt: "desc" },
        distinct: ["productId"],
        select: { productId: true, rawData: true },
      });
      for (const o of obs) {
        const raw = o.rawData as { cardmarket?: unknown } | null;
        if (raw && raw.cardmarket) hasCardmarketData.add(o.productId);
      }
    }

    for (const p of products) {
      const isSingle = p.category === "SINGLE_CARD";

      // Cardmarket-URL
      let cmUrl: string;
      let exact = false;
      if (isSingle && p.card?.tcgExternalId && hasCardmarketData.has(p.id)) {
        cmUrl = slugCache[p.card.tcgExternalId] ?? cardmarketExactUrl(p.card.tcgExternalId);
        exact = true;
      } else if (isSingle && p.card) {
        cmUrl = cardmarketSearchUrl(p.card.name);
      } else {
        cmUrl = cardmarketSearchUrl(p.title.replace(/\s*·\s*/g, " ").trim());
      }

      // Tradera-URL — specifik med kategori och kortdetaljer
      const trTerm = isSingle && p.card
        ? `${p.card.name} ${p.card.set.name.replace(/^Pokémon\s+TCG:\s*/i, "")} ${p.card.number}`
        : p.title.replace(/\s*·\s*/g, " ").trim();
      const trUrl = traderaSearchUrlSpecific(trTerm, p.category);

      const cmOffer = p.offers.find((o) => o.retailerId === cardmarket.id);
      // Nedgradera aldrig en redan löst engelsk slug till en redirect.
      if (cmOffer && isEnglishCardmarketUrl(cmOffer.url) && !isEnglishCardmarketUrl(cmUrl)) {
        cmExact++;
      } else if (cmOffer && cmOffer.url !== cmUrl) {
        await prisma.offer.update({ where: { id: cmOffer.id }, data: { url: cmUrl } });
        if (exact) cmExact++;
        else cmSearch++;
      } else if (cmOffer && exact) {
        cmExact++; // redan korrekt
      }

      const trOffer = p.offers.find((o) => o.retailerId === tradera.id);
      // Rör inte riktiga skrapade Tradera-offers (de pekar på en specifik annons)
      if (trOffer && trOffer.url.includes("/search?") && trOffer.url !== trUrl) {
        await prisma.offer.update({ where: { id: trOffer.id }, data: { url: trUrl } });
        trFixed++;
      }
    }
  }

  console.log("🎉 Klart!");
  console.log(`   Cardmarket exakta produktlänkar: ${cmExact}`);
  console.log(`   Cardmarket sök-länkar uppdaterade: ${cmSearch}`);
  console.log(`   Tradera sök-länkar uppdaterade: ${trFixed}`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
