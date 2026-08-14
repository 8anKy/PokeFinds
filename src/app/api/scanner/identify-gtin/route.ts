/**
 * POST /api/scanner/identify-gtin — SEALED-identifiering på streckkod.
 *
 * Klienten avkodar asken lokalt (`src/services/scanner/barcode.ts`) och skickar
 * BARA koden. Uppslaget är därför en EXAKT join på `Product.gtin` — ingen bild,
 * inget vision-anrop, ingen fuzzy-poäng, noll rörlig kostnad. Det är hela skälet
 * att sealed går den här vägen i stället för konstavtryckets: en booster box är
 * ett 3D-objekt vars färglayout ändras med vinkeln, medan koden på asken är
 * samma nummer i varje butik i världen.
 *
 * ⛔ EN MISS ÄR ETT NORMALT UTFALL, INTE ETT FEL. Uppmätt GTIN-täckning på våra
 * riktiga offers är ~73 % (se CLAUDE.md), och två av butikerna publicerar ingen
 * kod alls — så var fjärde ask kommer att sakna motsvarighet i katalogen. Ett
 * 404 hade tvingat klienten att felhantera det vanliga fallet; svaret är i
 * stället 200 med `found: false`, så gränssnittet kan erbjuda manuell sökning.
 */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireEntitledUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { normalizeGtin } from "@/lib/gtin";
import { effectivePlanTier, isPro } from "@/lib/plan";
import { rateLimit } from "@/lib/rate-limit";
import { getProductValues } from "@/services/products";
import { getScannerQuota, recordScanUsage } from "@/services/scanner";

export const dynamic = "force-dynamic";

const schema = z.object({
  /**
   * En kod, eller de få kandidater en videoruta råkade innehålla (asken bredvid,
   * distributörens etikett på baksidan). Taket är lågt med flit: klienten ska
   * skicka det den LÄST, inte beställa en batch-sökning.
   */
  gtin: z.union([
    z.string().min(4).max(32),
    z.array(z.string().min(4).max(32)).min(1).max(8),
  ]),
});

/** Fälten den befintliga kandidatlistan i /skanna renderar (ScanCandidate). */
interface SealedMatch {
  /** Diskriminant: låter klienten skilja en sealed-träff från en kortkandidat. */
  kind: "SEALED";
  /** ALLTID null — en sealed-produkt har inget Card. Se rapporten om /confirm. */
  cardId: null;
  productId: string;
  name: string;
  setName: string;
  /** Sealed har inget samlarnummer. Tom sträng, aldrig en påhittad platshållare. */
  number: string;
  rarity: string;
  imageUrl: string | null;
  slug: string;
  variantLabel: string | null;
  /** 1 = exakt nyckelträff. Ingen gradering finns att göra: koden stämmer eller inte. */
  score: number;
  estimatedValue: number | null;
  /** Kanonisk GTIN-14 som gav träffen (visning/felsökning). */
  gtin: string | null;
  category: string;
}

export async function POST(req: Request) {
  try {
    const user = await requireEntitledUser();

    // Samma tak som /identify. Avkodningen sker i klienten och en ask som ligger
    // still framför linsen läses om och om igen — klienten ska avduplicera, men
    // taket får inte hänga på att den gör det.
    const { ok } = await rateLimit(`scanner-gtin:${user.id}`, 60, 60 * 1000);
    if (!ok) {
      throw new ServiceError(429, "För många skanningar på kort tid. Vänta en stund.");
    }

    const input = schema.parse(await req.json());

    // KVOTEN GRINDAS FÖRE UPPSLAGET, precis som i vision-vägen. Den binder inte
    // en kostnad här (uppslaget är en indexerad SELECT) utan VÄRDET: se
    // beslutet vid recordScanUsage längst ner.
    const quota = await getScannerQuota(user.id, effectivePlanTier(user), user.role);
    if (quota.remaining <= 0) {
      throw new ServiceError(
        429,
        isPro(user)
          ? `Du har nått månadens gräns på ${quota.limit} skanningar. Tillbaka nästa månad.`
          : `Du har använt dina ${quota.limit} gratis skanningar denna månad. Uppgradera till Pro för fler.`
      );
    }

    // ⛔ SERVERN NORMALISERAR OM, ÄVEN OM KLIENTEN REDAN GJORT DET. Klienten är
    // inte en betrodd part, och `Product.gtin` lagras kanoniskt (GTIN-14) — en
    // ojämförd rå kod hade tyst gett noll träffar på en produkt vi HAR.
    const raw = Array.isArray(input.gtin) ? input.gtin : [input.gtin];
    const codes = [...new Set(raw.map((r) => normalizeGtin(r)).filter((g): g is string => !!g))];
    if (codes.length === 0) {
      // Checksiffran höll inte. Det är inte ett fel i anropet utan en misslyckad
      // avläsning — och en misslyckad avläsning ska ge INGENTING, aldrig en
      // gissning på närmaste produkt.
      return jsonOk({ found: false, reason: "invalid_gtin", gtin: null, match: null, remaining: quota.remaining });
    }

    const rows = await prisma.product.findMany({
      where: { gtin: { in: codes } },
      select: {
        id: true,
        title: true,
        slug: true,
        imageUrl: true,
        variantLabel: true,
        category: true,
        gtin: true,
        lowestPriceOre: true,
        rankScore: true,
        set: { select: { name: true } },
      },
      // `Product.gtin` är MEDVETET inte @unique (katalogdubbletter ska krocka,
      // inte krascha importen), så flera rader ÄR möjligt. Deterministisk
      // ordning krävs — ett `take` utan `orderBy` är ett slumpurval.
      orderBy: { id: "asc" },
      take: 5,
    });

    if (rows.length === 0) {
      // MISSEN BOKFÖRS INTE. /identify skapar en rad även för no-match, för där
      // HAR vision-anropet redan kostat pengar och budgeten måste kunna följas.
      // Här kostade uppslaget ingenting, så en rad hade bara varit en Neon-
      // skrivning + brus i skannertelemetrin.
      return jsonOk({ found: false, reason: "not_found", gtin: codes[0], match: null, remaining: quota.remaining });
    }

    // Vid dubblett: den rad som faktiskt bär ett pris vinner, sedan högst
    // rankScore. Båda finns redan i katalogen och är exakt vad "den av
    // dubbletterna som är den levande posten" betyder.
    const best = [...rows].sort(
      (a, b) =>
        Number(b.lowestPriceOre != null) - Number(a.lowestPriceOre != null) ||
        b.rankScore - a.rankScore ||
        a.id.localeCompare(b.id)
    )[0];

    // Värdet hämtas ur SAMMA väg som produktsidan och samlingen (lägsta direkta
    // offer, live) — inte ur `lowestPriceOre`-cachen. Två värderingsvägar som
    // visar olika siffra för samma produkt är en buggrapport som väntar.
    const estimatedValue = (await getProductValues([best.id])).get(best.id) ?? null;

    const match: SealedMatch = {
      kind: "SEALED",
      cardId: null,
      productId: best.id,
      name: best.title,
      setName: best.set?.name ?? "",
      number: "",
      rarity: "",
      imageUrl: best.imageUrl,
      slug: best.slug,
      variantLabel: best.variantLabel,
      score: 1,
      estimatedValue,
      gtin: best.gtin,
      category: best.category,
    };

    /**
     * KVOTBESLUT: en TRÄFF räknas, en miss gör det inte.
     *
     * Kvoten mäter VÄRDET kunden får, inte vår kostnad — det står uttryckligen i
     * getScannerQuota, och precedensen finns redan: en bulk-cell som avgörs av
     * BILDEN (noll API-anrop) bokförs också. En streckkodsträff är samma klass:
     * gratis för oss, ett identifierat objekt för kunden.
     *
     * Alternativet — gratis streckkodsskanning — övervägdes och valdes bort. Det
     * hade varit försvarbart på ren kostnadsgrund, men gav två problem: (1) en
     * kund kunde inventera hela sin sealed-hylla utan att kvoten rörde sig medan
     * varje kort kostar kvot, vilket är omöjligt att förklara i gränssnittet, och
     * (2) det gör kvotsiffran till ett mått på VÅR kostnad i stället för på
     * levererat värde, dvs precis den kostnadsbaserade modell projektet redan
     * förkastat en gång. Vill man ändå göra den gratis är det ETT anrop nedan som
     * ska bort — men gör det som ett produktbeslut, inte som en optimering.
     */
    const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
    const jobId = await recordScanUsage(
      user.id,
      isAdmin
        ? {
            // ⛔ v: 3, INTE 1. Telemetri-/scoreboard-skripten filtrerar på v===1
            // och räknar då bild- och modellträffsäkerhet; en streckkodsrad har
            // varken avtryck eller modellsvar och hade räknats som en miss i
            // varje sådan mätning. Samma skäl som bulk-felsökningens v: 2.
            v: 3,
            provider: "streckkod",
            gtin: best.gtin,
            candidates: rows.length,
            chosen: { productId: best.id, title: best.title },
          }
        : undefined,
      true,
      // En streckkodsträff är ett rent DB-uppslag — noll API-anrop, alltså
      // bevisligen 0 kr. `model: null` bokför det som gratis i stället för omätt.
      { model: null }
    );

    return jsonOk({
      found: true,
      gtin: best.gtin,
      match,
      /** >0 = katalogen har flera produkter med samma kod (dubblett att städa). */
      duplicates: rows.length - 1,
      remaining: Math.max(0, quota.remaining - 1),
      /** Admin: bär en manuell korrigering vidare, som i /identify. */
      jobId: isAdmin ? jobId : null,
    });
  } catch (e) {
    return apiError(e);
  }
}
