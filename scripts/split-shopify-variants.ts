/**
 * ENGÅNGSMIGRERING — ger varje SKU på en Shopify-SORTIMENTSSIDA sin egen butikslänk.
 *
 * Bakgrund: Speltrollet säljer Mega Emboar / Mega Meganium / Mega Feraligatr ex Box som
 * tre VARIANTER av EN Shopify-produkt. ShopifyAdapter kollapsade dem till en enda annons
 * på den nakna handle-URL:en → bara EN av boxarna fick en Speltrollet-länk (vilken avgjordes
 * av matcharen = myntkast), de andra två stod utan, och länkrevisionen larmade varje vecka.
 * Adaptern splittar nu sortiment till en annons per variant (`?variant=…`, se
 * splittableVariants). Det här skriptet flyttar BEFINTLIG data dit: repekar den gamla
 * offern till rätt variant och skapar de som saknades.
 *
 * VARFÖR SIDAN OCH INTE FEEDEN: sortimentssidan behöver inte ligga i en kollektion som
 * adaptern läser (Speltrollets ex-box ligger i "ascended-heroes", och kollektionsfiltret
 * kräver ordet "pokemon" → den syns inte i feeden alls). Vi läser därför butikens
 * `/products/{handle}.js` direkt: den ger variantens namn, pris, lagerstatus OCH streckkod
 * i EN request — ingen separat gtin-hämtning behövs.
 *
 * STRECKKODEN ÄR POÄNGEN: varje variant har en egen (Emboar …1972, Meganium …1973,
 * Feraligatr …1974). En sortimentssida publicerar bara EN av dem i sin JSON-LD, och den
 * koden hade smittat katalogen: "Mega Meganium ex Box" bar EMBOARS kod, ärvd från MaxGamings
 * sortimentssida. Bär produkten en SYSKONVARIANTS kod är det bevisbart ett sortiments-
 * artefakt — bara då skriver vi över den. Bär den en HELT främmande kod rör vi ingenting:
 * då är vår bindning osäker och en människa får titta.
 *
 * Torrkörning är DEFAULT och skriver ingenting (torrkörningen som SKREV är en läxa):
 *   node scripts/with-prod-db.mjs npx tsx scripts/split-shopify-variants.ts \
 *     --page https://speltrollet.se/products/pokemon-ascended-heroes-ex-box
 *   … samma rad + --apply när planen ser rätt ut.
 * Utan --page skannas de Shopify-butiker adaptern faktiskt ser (feed-upptäckta sortiment).
 */
import { PrismaClient, StockStatus } from "@prisma/client";
import {
  DragonsLairAdapter, GoblinenAdapter, ManatorskAdapter, SamlarhobbyAdapter, SpeltrolletAdapter,
  splittableVariants, variantUrl,
} from "../src/scrapers/adapters/shopify-adapter";
import { cleanListingTitle, loadMatchIndex, matchProduct, productsConflict } from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";
import { formatGtin, normalizeGtin } from "../src/lib/gtin";
import { politeFetch } from "../src/scrapers/http";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const PAGES = process.argv.reduce<string[]>((acc, a, i, all) => {
  if (a === "--page" && all[i + 1]) acc.push(all[i + 1]);
  return acc;
}, []);

// Bara Shopify-butiker kan ha sortimentsvarianter — övriga plattformar ger en URL per SKU.
const STORES = [
  new SpeltrolletAdapter(), new GoblinenAdapter(), new ManatorskAdapter(),
  new SamlarhobbyAdapter(), new DragonsLairAdapter(),
].map((a) => ({ name: a.name, baseUrl: a.baseUrl, adapter: a }));

/** En variant, som den ser ut i butikens egen /products/{handle}.js. */
type JsVariant = { id: number; title?: string; price: number; available: boolean; barcode?: string | null };
/** En annons vi vill binda till en katalogprodukt. */
type Item = { title: string; url: string; price: number; stockStatus: StockStatus; gtin: string | null };

/**
 * Butikens variant-JSON. Priset är redan i ÖRE här (till skillnad från products.json som
 * ger "599.00"), och barcode finns — /products.json utelämnar den med flit.
 */
async function assortmentItems(store: { name: string; baseUrl: string }, pageUrl: string): Promise<Item[]> {
  const handle = pageUrl.match(/\/products\/([^/?#]+)/)?.[1];
  if (!handle) return [];
  const res = await politeFetch(`${store.baseUrl}/products/${handle}.js`, {
    delayMs: 800,
    headers: { cookie: "localization=SE", "accept-language": "sv-SE" },
  });
  if (!res.ok) {
    console.log(`  ⚠ ${store.name}: HTTP ${res.status} för ${handle}`);
    return [];
  }
  const data = (await res.json()) as { title?: string; variants?: JsVariant[] };
  const title = data.title?.trim();
  if (!title) return [];
  // SAMMA grind som adaptern — annars skulle skriptet kunna splittra en färgkarta
  // som scrapern sedan aldrig återskapar.
  const split = splittableVariants(title, (data.variants ?? []).map((v) => ({ ...v, price: String(v.price / 100) })));
  if (!split) {
    console.log(`  – ${store.name}: "${title}" är inget sortiment (ingen split).`);
    return [];
  }
  const byId = new Map((data.variants ?? []).map((v) => [v.id, v]));
  return split.map((v) => {
    const raw = byId.get(v.id)!;
    return {
      title: `${title} - ${raw.title!.trim()}`,
      url: variantUrl(store.baseUrl, handle, raw.id),
      price: raw.price,
      stockStatus: raw.available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
      gtin: normalizeGtin(raw.barcode),
    };
  });
}

async function main() {
  console.log(APPLY ? "APPLY — skriver till databasen.\n" : "TORRKÖRNING — inget skrivs. Lägg till --apply.\n");

  const retailers = await prisma.retailer.findMany({ select: { id: true, name: true } });
  const retailerByName = new Map(retailers.map((r) => [r.name, r.id]));
  const index = await loadMatchIndex();

  // Sortimentssidor att migrera: explicita --page + de adaptern hittar i feeden.
  const targets: { store: (typeof STORES)[number]; pageUrl: string }[] = [];
  for (const pageUrl of PAGES) {
    const store = STORES.find((s) => pageUrl.startsWith(s.baseUrl));
    if (!store) { console.log(`⚠ Okänd butik för ${pageUrl} — hoppar.`); continue; }
    targets.push({ store, pageUrl });
  }
  if (PAGES.length === 0) {
    for (const store of STORES) {
      const probe = await store.adapter.fetchProducts().catch(() => null);
      if (!probe) continue;
      const bases = new Set(
        probe.products.filter((p) => /[?&]variant=\d+/.test(p.url)).map((p) => p.url.split("?")[0])
      );
      for (const pageUrl of bases) targets.push({ store, pageUrl });
    }
  }
  console.log(`${targets.length} sortimentssidor att gå igenom.\n`);

  let created = 0, repointed = 0, codes = 0, skipped = 0, cleared = 0;

  for (const { store, pageUrl } of targets) {
    const retailerId = retailerByName.get(store.name);
    if (!retailerId) { console.log(`⚠ ${store.name}: ingen Retailer-rad — hoppar.`); continue; }

    const items = await assortmentItems(store, pageUrl);
    if (items.length === 0) continue;
    // Syskonens koder — behövs för att känna igen ett sortiments-artefakt (se filhuvudet).
    const siblingCodes = new Set(items.map((i) => i.gtin).filter((g): g is string => !!g));
    console.log(`\n■ [${store.name}] ${pageUrl}  (${items.length} varianter)`);

    for (const it of items) {
      const price = `${(it.price / 100).toFixed(0)} kr`;
      console.log(`\n  ${it.title}\n    ${price} · ${it.stockStatus} · gtin=${formatGtin(it.gtin) ?? "—"}\n    ${it.url}`);

      // Redan bunden (körd förut, eller scrape-all hann före)?
      const owner = await prisma.offer.findFirst({
        where: { retailerId, url: it.url },
        select: { id: true, product: { select: { title: true } } },
      });
      if (owner) { console.log(`    = OFÖRÄNDRAD — offer finns redan → "${owner.product.title}"`); continue; }

      const clean = cleanListingTitle(it.title);

      // 1) Streckkoden är exakt — den slår varje titelpoäng. MEN katalogens kod kan vara
      //    smittad: en sortimentssida publicerar EN kod för flera SKU:er, och den koden
      //    landade på grannprodukten (Mega Meganium ex Box bar EMBOARS …1972, ärvd från
      //    MaxGamings sortimentssida). Koden vi slår upp med kommer från butikens EGEN
      //    variant-JSON — den tillhör bevisligen DEN HÄR varianten. Pekar den på en produkt
      //    vars titel vakterna säger emot är det katalogen som har fel, inte annonsen.
      //    Nolla den felaktiga koden och låt titeln avgöra. GISSA ALDRIG en ersättningskod.
      let productId: string | null = null;
      if (it.gtin) {
        const byGtin = await prisma.product.findFirst({
          where: { gtin: it.gtin },
          select: { id: true, title: true },
        });
        if (byGtin && productsConflict(byGtin.title, clean)) {
          console.log(
            `    # NOLLAR fel streckkod: "${byGtin.title}" bar ${formatGtin(it.gtin)}, ` +
              `som är den här variantens kod (sortiments-artefakt)`
          );
          cleared++;
          if (APPLY) await prisma.product.update({ where: { id: byGtin.id }, data: { gtin: null } });
        } else if (byGtin) {
          productId = byGtin.id;
        }
      }
      // 2) Annars titelmatchning. Sortimentets syskon skiljer sig BARA på karaktärsnamnet,
      //    så vaktbatteriet (characterMismatch m.fl.) är det som hindrar att Meganium-
      //    varianten landar på Emboar-produkten.
      if (!productId) {
        const m = await matchProduct(normalizeTitle(clean), index, clean);
        if (m && m.confidence >= 0.85) productId = m.productId;
        else if (m) console.log(`    ! svag match (${m.confidence.toFixed(2)}) — lämnas åt auto-importen`);
      }
      if (!productId) { console.log(`    ✗ HOPPAS — ingen säker katalogprodukt`); skipped++; continue; }

      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, title: true, gtin: true },
      });
      if (!product) { console.log(`    ✗ HOPPAS — produkten borta`); skipped++; continue; }
      console.log(`    → katalog: "${product.title}" (gtin=${formatGtin(product.gtin) ?? "—"})`);

      if (productsConflict(product.title, clean)) {
        console.log(`    ✗ HOPPAS — en titelvakt säger emot bindningen`);
        skipped++;
        continue;
      }
      // Produkten bär en HELT främmande kod (inte ett syskons) → vår bindning kan vara fel.
      if (it.gtin && product.gtin && product.gtin !== it.gtin && !siblingCodes.has(product.gtin)) {
        console.log(`    ✗ HOPPAS — produkten bär en främmande streckkod`);
        skipped++;
        continue;
      }

      // Butikens befintliga offer för produkten = den gamla nakna sortimentslänken.
      // REPEKA den (behåll offer-id → watchlists och historik hänger kvar) i stället för
      // att skapa en andra och lämna en död kvar.
      const stale = await prisma.offer.findFirst({
        where: { productId: product.id, retailerId, condition: "SEALED" },
        select: { id: true, url: true },
      });
      if (stale) {
        console.log(`    ↻ repekar offer ${stale.id}\n       ${stale.url}\n       → ${it.url}`);
        repointed++;
        if (APPLY) {
          await prisma.offer.update({
            where: { id: stale.id },
            data: {
              url: it.url, price: it.price, currency: "SEK",
              stockStatus: it.stockStatus, gtin: it.gtin, lastSeenAt: new Date(),
            },
          });
        }
      } else {
        console.log(`    + skapar offer`);
        created++;
        if (APPLY) {
          await prisma.offer.create({
            data: {
              productId: product.id, retailerId, condition: "SEALED", language: "EN",
              price: it.price, currency: "SEK", stockStatus: it.stockStatus,
              url: it.url, gtin: it.gtin, lastSeenAt: new Date(),
            },
          });
        }
      }

      // Streckkod på produkten: sätt när den saknas, LAGA när den bär ett syskons kod.
      if (it.gtin && product.gtin !== it.gtin) {
        console.log(
          `    # streckkod: ${formatGtin(product.gtin) ?? "saknas"} → ${formatGtin(it.gtin)}` +
            (product.gtin ? "  (bar ett SYSKONS kod — sortiments-artefakt)" : "")
        );
        codes++;
        if (APPLY) await prisma.product.update({ where: { id: product.id }, data: { gtin: it.gtin } });
      }
    }
  }

  console.log(
    `\n\nSUMMERING: ${repointed} offers repekade · ${created} skapade · ${codes} streckkoder satta · ` +
      `${cleared} felaktiga nollade · ${skipped} hoppade` +
      (APPLY ? "" : "\n(Torrkörning — inget skrevs.)")
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
