/**
 * PRISERNA ÄR SKRIVNA — SLÄNG DEN CACHADE BILDEN AV DEM.
 *
 * Publika läs-sidor är ISR-cachade i en timme och läser dessutom genom `cachedRead`
 * (samma TTL). Det är kvot-kritiskt och ska INTE sänkas — men det gav en synlig
 * lögn i andra änden: prisjobben skriver ~16:00 UTC, och en sida som cachats strax
 * innan visar gårdagens sista punkt. Eftersom Next serverar den GAMLA sidan medan
 * den nya renderas i bakgrunden (stale-while-revalidate) ser den FÖRSTA besökaren
 * efter varje jobb alltid gårdagens graf — vilket på en katalog med tunn trafik är
 * de flesta besökare. Symtomet ägaren såg: "bara några kort har dagens datum".
 *
 * Rutten invaliderar cachen i stället för att göra den kortare: sidor ingen besöker
 * renderas aldrig om, besökta sidor renderas om EN gång extra per jobb.
 *
 * Anropas av de schemalagda jobben när de faktiskt skrivit något:
 *   curl -X POST -H "x-cron-secret: $CRON_SECRET" https://www.foilio.se/api/revalidate
 *
 * Utan hemlighet i miljön svarar rutten 503 och gör INGENTING (samma självläkande
 * mönster som workflow-vakterna) — en öppen invalideringsknapp vore en gratis väg
 * att tvinga fram omrendering av hela katalogen.
 */
import { revalidatePath, revalidateTag } from "next/cache";
import { apiError, jsonOk } from "@/lib/api";
import { PRICE_CACHE_TAG } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const secret = process.env.REVALIDATE_SECRET ?? process.env.CRON_SECRET;
    if (!secret) {
      return jsonOk(
        { ok: false, reason: "REVALIDATE_SECRET/CRON_SECRET saknas — rutten är avstängd." },
        { status: 503 }
      );
    }
    if (req.headers.get("x-cron-secret") !== secret) {
      return jsonOk({ ok: false, reason: "Fel hemlighet." }, { status: 401 });
    }

    // Taggen tömmer datacachen (cachedRead). Sidcachen för de dynamiska
    // produktsidorna tas dessutom via revalidatePath med "page"-typen — den
    // träffar ALLA slugs på en gång, till skillnad från en path per produkt.
    revalidateTag(PRICE_CACHE_TAG);
    revalidatePath("/[locale]/produkter/[slug]", "page");
    revalidatePath("/[locale]/sets/[id]", "page");
    revalidatePath("/[locale]", "page");
    revalidatePath("/[locale]/marknad", "page");
    revalidatePath("/[locale]/sets", "page");

    return jsonOk({ ok: true, tag: PRICE_CACHE_TAG });
  } catch (e) {
    return apiError(e);
  }
}
