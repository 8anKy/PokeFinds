/**
 * VECKOBREVET — appens första icke-transaktionella massutskick.
 *
 * **Ägarbeslut 2026-08-16**: brevet går till ALLA konton, inte bara Pro, och det
 * bär både det PERSONLIGA (samlingens värde, prisfall på bevakat, restocks i
 * bevakade set) och en PLATTFORMSPULS som är densamma för alla. Pulsen är hela
 * skälet att brevet finns för den som ännu inte lagt upp något: "den här veckan
 * hittade vi N varor under marknadspris" är det som visar att det finns något att
 * hämta här. ⛔ Följdändring i samma omgång: `Market.proDesc` sålde veckorapporter
 * som en PRO-förmån. Går brevet till alla är den formuleringen falsk och togs bort
 * ur båda språkfilerna.
 *
 * ⛔ **"UNDER MARKNADSPRIS" RÄKNAS DIREKT, ALDRIG UR `DealCheck`.** Den nattliga
 *    `verifyDeals()` stängs av i samma omgång som det här bygget, så tabellen
 *    slutar vara färsk — en siffra ur den hade blivit tyst gammal och sedan tyst
 *    fel. Referensen är samma `CM_MIN_CTE` (billigaste Cardmarket-offer per
 *    produkt) och samma band (`DEAL_MIN_DISCOUNT`/`DEAL_MAX_DISCOUNT`) som
 *    Fynd-feeden och produktsidans CM-rad använder. Enda skillnaden mot
 *    `DEAL_OFFER_WHERE` är avsiktlig: BUTIKS-offers i stället för Tradera-offers,
 *    plus `hiddenAt IS NULL`.
 *
 * ⛔ **MARKNADSPLATSER ÄR UTESLUTNA UR BUTIKSFYNDET.** Cardmarket kan per
 *    definition inte vara ett fynd mot sig självt, och Tradera-annonser är en egen
 *    (LLM-verifierad, Pro-grindad) funktion. Ett overifierat auktionsstartpris i
 *    ett massutskick vore precis den fejkade rekommendation vi aldrig får skicka.
 *
 * ⛔ **ANTALET ÄR ROBUSTARE ÄN EXEMPLEN.** Räkningen tas över hela bandet;
 *    exempelraderna passerar dessutom två SNÄVARE vakter (se EXAMPLE_*). Hellre
 *    "93 utan exempel" än "93 med ett felaktigt" — ett fel exempel är en fejkad
 *    rekommendation till varenda mottagare samtidigt.
 *
 * ⛔ **AVREGISTRERING ÄR ETT KRAV.** Jobbet VÄGRAR skicka om den signerade
 *    avanmälningsnyckeln saknas (`requireUnsubscribeSecret`) — ett massutskick med
 *    döda avregistreringslänkar lämnar spamknappen som enda utväg, och den kostar
 *    foilio.se:s avsändarrykte permanent. `notificationSettings.email` är
 *    fortfarande MASTER; `weekly` är den egna spaken.
 *
 * ⛔ **INGET TOMT BREV.** Saknar en mottagare både personligt innehåll OCH en puls
 *    med siffror hoppas hen över helt, utan stämpel.
 *
 * Körs som ett STEG i scrape-all.yml (Neon är redan vaken i det fönstret — en egen
 * cron hade varit ytterligare en väckning à minst 300 s). Jobbet avgör själv om det
 * är rätt veckodag.
 */
import { prisma } from "@/lib/db";
import { isPermanentMailError, sendMail } from "@/lib/mailer";
import {
  weeklyDigestEmail,
  type DigestDealExample,
  type DigestDrop,
  type DigestMover,
  type DigestRestock,
} from "@/emails/templates";
import { parseNotificationSettings } from "@/lib/notification-settings";
import { requireUnsubscribeSecret, unsubscribeUrl } from "@/lib/unsubscribe-token";
import { computeCollectionValue, type CollectionMover } from "@/services/collection";
import {
  CM_MIN_CTE,
  DEAL_MAX_DISCOUNT,
  DEAL_MIN_DISCOUNT,
  DIRECT_URL_SQL,
  computePriceChange7d,
} from "@/services/products";
import { NOT_HIDDEN_SQL } from "@/lib/product-visibility";
import { SET_FULL_TOTAL_SQL } from "@/lib/set-denominator";
import { isSealedCategory } from "@/lib/product-category";
import { utcDaysAgo } from "@/lib/utils";

/**
 * Veckodag i UTC (0 = söndag). Måndag som default: brevet ska ligga överst i
 * inkorgen när veckan börjar, inte konkurrera med helgens shopping.
 * ⛔ UTC, aldrig lokal dag — scrape-all kör 02:00 UTC och en lokal veckodagsläsning
 * hade flyttat utskicket ett dygn beroende på var jobbet råkade köra.
 */
const DIGEST_WEEKDAY = (() => {
  // ⛔ Tomma strängen måste fällas FÖRE Number(): en `env:`-rad i workflowet som
  // pekar på en osatt repository-variabel blir "" och `Number("")` är 0 — dvs
  // brevet hade flyttat sig till SÖNDAG utan att någon rört en inställning.
  const raw = (process.env.WEEKLY_DIGEST_WEEKDAY ?? "").trim();
  if (!raw) return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : 1;
})();

/**
 * Dubblettspärrens fönster. 6 dygn (inte 7): scrape-all kan starta någon minut
 * tidigare eller senare, och exakt 7 hade kunnat missa en vecka helt.
 */
const RESEND_WINDOW_DAYS = 6;

/** Paus mellan utskick — Resend tar 2 req/s. Samma tal som engångsutskicken. */
const GAP_MS = 600;

/** Hur stort ett prisfall ska vara för att vara värt en rad. Under det är det brus. */
const MIN_DROP_PERCENT = 5;

const MAX_DROPS = 5;
const MAX_RESTOCKS = 5;
const MAX_MOVERS = 3;
const MAX_EXAMPLES = 4;

/**
 * ⛔ EXEMPELVAKTERNA ÄR SNÄVARE ÄN RÄKNINGEN — MED FLIT.
 *
 * `EXAMPLE_MAX_DISCOUNT`: en svensk butik som ligger mer än så här under
 * Cardmarket är i praktiken oftare en FELMATCHAD produkt eller en gammal
 * butikslänk än ett äkta fynd (samma misstro som `DEAL_MAX_DISCOUNT` bygger på,
 * fast strängare eftersom raden namnges i ett massutskick).
 *
 * `EXAMPLE_MIN_PRICE_ORE`: under hundralappen är procenttalet mest avrundning,
 * och raden säljer ingenting. Båda påverkar BARA exemplen, aldrig antalet.
 */
const EXAMPLE_MAX_DISCOUNT = 0.6;
const EXAMPLE_MIN_PRICE_ORE = 10_000;

/**
 * ⛔ NAMNGIVNA EXEMPEL ÄR AVSTÄNGDA (2026-08-16). ANTALET SKICKAS, RADERNA INTE.
 *
 * Första skarpa körningen mot prod gav 6 varor i bandet. Vakterna ovan fällde de
 * två grövsta (en KOREANSK box 70 % under en JP/EN-referens, en "Jolteon VMAX
 * Premium Collection EU Version" 78 % under) — men en tog sig igenom:
 *
 *   Coolcard "Twilight Masquerade Booster Box" 1 999 kr mot CM 2 915 kr = 31 %
 *   under. Butikens egen URL säger "liten booster box innehåller 18 boosters".
 *   CM-referensen är den ORDINARIE boxen (36 paket). Per paket är butikens box
 *   alltså DYRARE — raden är ett falskt fynd, byggt av två korrekta priser på
 *   två olika varor.
 *
 * Procentgrindar kan inte fånga det: felet är produktMATCHNINGEN, inte rabattens
 * storlek. Att namnge den raden hade varit en fejkad rekommendation till varenda
 * mottagare samtidigt — precis det `verifyDeals()` en gång byggdes för att
 * förhindra, och den stängdes av i samma omgång som det här bygget.
 *
 * ANTALET är opåverkat: 6 varor ligger faktiskt i bandet, och en enskild
 * felmatchning flyttar inte den siffran på ett vilseledande sätt.
 *
 * FÖR ATT SLÅ PÅ IGEN krävs ett verifikationssteg som dömer på ANNONSEN (paket-
 * antal, språk, utgåva) — inte en till procentgrind. Sätt inte true utan det.
 */
const SHOW_DEAL_EXAMPLES = false;

/** Hur många restock-händelser vi hämtar för bevakningsavsnitten. */
const RESTOCK_EVENT_CAP = 1000;

/** Hur många påbörjade set vi visar komplettering för. */
const MAX_SET_PROGRESS = 3;

/**
 * ⛔ `||`, ALDRIG `??` — SAMMA BUGG SOM `EMAIL_FROM` I `src/lib/mailer.ts`.
 *
 * GitHub Actions expanderar `${{ vars.NEXT_PUBLIC_APP_URL }}` till TOM STRÄNG när
 * repository-variabeln inte finns (den finns INTE), och `"" ?? default` är `""` —
 * `??` fångar bara null/undefined, aldrig den tomma strängen.
 *
 * Följden i det skarpa utskicket 2026-08-16: varje länk i brevet blev RELATIV
 * (`/produkter?sortera=prisfall`), mejlklienten satte ihop `http:///produkter…`
 * och knappen ledde till en felsida. Tyst — jobbet rapporterade lyckade utskick.
 *
 * Mönstret är familjen "ett fält som FINNS men är tomt passerar en vakt som bara
 * letar efter att det saknas" (samma som `variantLabel`-vakten 07-28). Läser du
 * en `process.env`-default i den här kodbasen: `||`, och fäll tomma strängar.
 */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se";

/**
 * Bild-URL som fungerar i EN MEJLKLIENT. Katalogens bilder är absoluta och går
 * rakt in; en app-relativ sökväg (egen uppladdning) måste få värdnamnet påklistrat
 * — annars blir det exakt samma trasiga `http:///…` som APP_URL-buggen ovan gav.
 * Allt annat (data:-URI:er, skräp) blir `null` → mallen hoppar bilden.
 */
function mailImage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${APP_URL}${url}`;
  return null;
}

export interface WeeklyDigestResult {
  /** Sant när jobbet avstod för att det var fel veckodag (inget annat kördes). */
  skippedWrongDay: boolean;
  candidates: number;
  sent: number;
  skippedOptedOut: number;
  skippedNoContent: number;
  failed: number;
  /** Plattformspulsens huvudsiffra, för loggen. */
  underMarketCount: number;
}

interface UnderMarketRow {
  productId: string;
  title: string;
  slug: string;
  retailerName: string;
  price: number;
  cmPrice: number;
}

/** En rad ur den AGGREGERADE set-kompletteringsfrågan (en rad per användare+set). */
interface SetProgressRow {
  userId: string;
  setId: string;
  setName: string;
  owned: number;
  total: number;
}

/** Set-komplettering som brevet visar. Speglar `setProgress` i mallens kontrakt. */
interface DigestSetProgress {
  setName: string;
  owned: number;
  total: number;
  url: string;
}

/** Identitet + produktlänk för en samlingspost (för moversens dedup och länkar). */
export interface CollectionRef {
  /** VARANS identitet (kort eller produkt) — INTE postens. Se dedupen nedan. */
  key: string;
  url: string | null;
}

interface PlatformPulse {
  underMarketCount: number;
  minDiscountPercent: number;
  examples: DigestDealExample[];
  restockCount: number;
  newSetCount: number;
}

const productUrl = (slug: string) => `${APP_URL}/produkter/${slug}`;

/**
 * Butiks-offers i fynd-bandet mot Cardmarket. EN rad per produkt (den billigaste),
 * så räkningen blir "antal VAROR under marknadspris" och inte "antal annonser".
 */
async function underMarketOffers(): Promise<UnderMarketRow[]> {
  const [cm, tradera] = await Promise.all([
    prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } }),
    prisma.retailer.findFirst({ where: { name: "Tradera" }, select: { id: true } }),
  ]);
  // Utan CM-raden finns ingen referens — då är svaret "vi vet inte", inte noll.
  if (!cm) return [];
  // Saknas Tradera helt finns inget att exkludera; en tom sträng matchar inget id.
  const traderaId = tradera?.id ?? "";

  return prisma.$queryRawUnsafe<UnderMarketRow[]>(
    `${CM_MIN_CTE}
    SELECT DISTINCT ON (o."productId")
           o."productId" AS "productId",
           p.title       AS title,
           p.slug        AS slug,
           r.name        AS "retailerName",
           o.price       AS price,
           cm.price      AS "cmPrice"
    FROM "Offer" o
      JOIN cm ON cm."productId" = o."productId"
      JOIN "Product" p ON p.id = o."productId"
      JOIN "Retailer" r ON r.id = o."retailerId"
    WHERE o."retailerId" <> $1 AND o."retailerId" <> $2
      AND o."stockStatus" = 'IN_STOCK' AND o.price > 0
      AND ${DIRECT_URL_SQL}
      AND p.category NOT IN ('SINGLE_CARD', 'GRADED_CARD', 'ACCESSORY', 'OTHER')
      AND p.${NOT_HIDDEN_SQL}
      AND o.price <= cm.price * (1 - $3)
      AND o.price >= cm.price * (1 - $4)
    ORDER BY o."productId", o.price ASC`,
    cm.id,
    traderaId,
    DEAL_MIN_DISCOUNT,
    DEAL_MAX_DISCOUNT
  );
}

/** Siffrorna som är samma för alla mottagare. Räknas EN gång per körning. */
async function loadPlatformPulse(weekAgo: Date, now: Date): Promise<PlatformPulse> {
  const [rows, restockCount, newSetCount] = await Promise.all([
    underMarketOffers(),
    prisma.restockEvent.count({
      // "Restock" = en övergång IN i lager. `newStatus: IN_STOCK` ensamt hade
      // räknat rader där varan redan var i lager.
      where: { detectedAt: { gte: weekAgo }, newStatus: "IN_STOCK", oldStatus: { not: "IN_STOCK" } },
    }),
    // ⛔ RELEASEDATE, ALDRIG `createdAt`. Raden löd först "N nya set i katalogen"
    // och räknade `createdAt` — formellt sant, men MÄTT 2026-08-16 gav den 33, och
    // alla 33 var japanska bokföringsrader som `sealed-set-label` skapat ur CM:s
    // expansionslista: noll kort, oftast ingen releaseDate, och till stor del set
    // som SLÄPPTES 2014–2020 (McDonald's 2014 Promo, Alter Genesis, Shocking Volt
    // Tackle). En läsare i ett nyhetsbrev läser "33 nya set" som 33 nya SLÄPP —
    // alltså ett vilseledande påstående byggt av äkta siffror, vilket är precis den
    // sortens tal CLAUDE.md förbjuder. Vi räknar därför faktiska släpp i fönstret;
    // blir det noll utelämnas raden hellre än att fyllas med katalogbrus.
    prisma.cardSet.count({ where: { releaseDate: { gte: weekAgo, lte: now } } }),
  ]);

  const examples: DigestDealExample[] = !SHOW_DEAL_EXAMPLES
    ? []
    : rows
    .filter(
      (r) =>
        r.price >= EXAMPLE_MIN_PRICE_ORE &&
        r.cmPrice > 0 &&
        1 - r.price / r.cmPrice <= EXAMPLE_MAX_DISCOUNT
    )
    // Rangordnas på SAMMA tal som raden visar (% under) — rankas de på sparade
    // kronor hamnar en 32 %-rad över en 55 %-rad och listan läser som fel sorterad.
    .sort((a, b) => a.price / a.cmPrice - b.price / b.cmPrice)
    .slice(0, MAX_EXAMPLES)
    .map((r) => ({
      title: r.title,
      url: productUrl(r.slug),
      retailerName: r.retailerName,
      priceOre: r.price,
      percentUnder: Math.round((1 - r.price / r.cmPrice) * 100),
    }));

  return {
    underMarketCount: rows.length,
    minDiscountPercent: Math.round(DEAL_MIN_DISCOUNT * 100),
    examples,
    restockCount,
    newSetCount,
  };
}

/**
 * ⛔ DEDUP PER VARA, INTE PER POST — OCH BARA I PRESENTATIONEN.
 *
 * Samlingen lagrar LOTS (ett andra köp av samma vara till ett annat pris blir en
 * EGEN rad — se `.claude/rules/collection-portfolio.md`: försäljningen kräver
 * poster), så `computeCollectionValue().movers` returnerar en post per LOT. Det
 * skarpa brevet 2026-08-16 listade därför "Prismatic Evolutions Super-Premium
 * Collection +7,3 % · 2 585,11 kr/st" TVÅ gånger i en lista på tre — mottagaren
 * läser det som en bugg, inte som två köp.
 *
 * ⛔ Dedupen sker FÖRE kapningen till MAX_MOVERS: kapar man först blir listan
 * kortare i stället för bredare, och tre rader ska betyda tre olika VAROR.
 * ⛔ Slå ALDRIG ihop lots i värdeberäkningen — bara här, i presentationen.
 *
 * Identiteten kommer ur `collectionRefs` (kort- eller produkt-id). Saknas posten
 * där (borttagen mellan frågorna) faller vi tillbaka på namn+set — sämre, men
 * aldrig sämre än att dubblera raden. Listan kommer sorterad på störst uppgång;
 * ordningen bevaras, så den dyraste/vassaste lotten av en vara är den som visas.
 */
export function pickMovers(
  movers: CollectionMover[],
  refs: Map<string, CollectionRef>,
  max = MAX_MOVERS
): DigestMover[] {
  const seen = new Set<string>();
  const out: DigestMover[] = [];
  for (const m of movers) {
    if (out.length >= max) break;
    const ref = refs.get(m.id);
    const key = ref?.key ?? `name:${m.name}|${m.setName ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: m.name,
      setName: m.setName,
      percent: m.percent,
      valueOre: m.value,
      imageUrl: mailImage(m.imageUrl),
      url: ref?.url ?? null,
    });
  }
  return out;
}

/**
 * SET-KOMPLETTERING FÖR HELA MOTTAGARLISTAN I **EN** FRÅGA.
 *
 * ⛔ `getSetCompletion()` (services/set-completion.ts) tar ETT set för EN användare
 * och kan alltså inte anropas här: 65 mottagare × deras påbörjade set hade blivit
 * N×M rundturer mot Neon — samma misstag som en gång höll computen vaken dygnet
 * runt, fast i ett jobb som redan har ett smalt fönster. Aggregeringen görs i
 * Postgres i stället.
 *
 * ⛔ SAMMA NÄMNARE SOM WEBBEN, ORDAGRANT. Uttrycket kommer från
 * `SET_FULL_TOTAL_SQL` (lib/set-denominator.ts) och RÄKNAR SOM `resolveSetTotals`.
 * Skriver man om det här för hand säger mejlet ett tal och set-fliken ett annat om
 * samma set — och det är mejlet man tror på, för det kom först.
 * Tidigare stod här `CASE WHEN s."totalCards" > 0`, alltså det TRYCKTA talet
 * (printedTotal): en samlare med secret rares fick "120 av 84" och föll ur listan
 * som "redan klar". Raden slängs fortfarande när `owned >= total` — "0 kort kvar"
 * är ingen anledning att öppna appen.
 *
 * Bara set där användaren äger MINST ett kort kommer med (JOIN:en ser till det).
 */
async function loadSetProgress(userIds: string[]): Promise<Map<string, DigestSetProgress[]>> {
  const byUser = new Map<string, DigestSetProgress[]>();
  if (userIds.length === 0) return byUser;

  // ⚠️ `$queryRawUnsafe`, inte taggad `$queryRaw`: nämnaruttrycket måste
  // interpoleras som SQL, och det kräver annars `Prisma.raw` — dvs en import av
  // `@prisma/client` högst upp i modulen. Den importen läser `.env` som sidoeffekt
  // och skrev över `NEXT_PUBLIC_APP_URL` INNAN `APP_URL` här i filen evaluerats,
  // vilket tyst gav mejlen localhost-länkar i test (och kunde ha gjort det i drift).
  // "Unsafe" gäller INDATA: `SET_FULL_TOTAL_SQL` är en konstant i vår egen källkod
  // och `userIds` binds som parameter ($1), aldrig konkateneras.
  const rows = await prisma.$queryRawUnsafe<SetProgressRow[]>(
    `SELECT ci."userId"                      AS "userId",
            s.id                             AS "setId",
            s.name                           AS "setName",
            COUNT(DISTINCT ci."cardId")::int AS "owned",
            ${SET_FULL_TOTAL_SQL}::int       AS "total"
     FROM "CollectionItem" ci
       JOIN "Card" c ON c.id = ci."cardId"
       JOIN "CardSet" s ON s.id = c."setId"
       LEFT JOIN (
         SELECT "setId", COUNT(*)::int AS cnt FROM "Card" GROUP BY "setId"
       ) k ON k."setId" = s.id
     WHERE ci."userId" = ANY($1)
     GROUP BY ci."userId", s.id, s.name, s."totalCardsFull", k.cnt`,
    userIds
  );

  const grouped = new Map<string, SetProgressRow[]>();
  for (const r of rows) {
    if (r.total <= 0 || r.owned <= 0 || r.owned >= r.total) continue;
    const list = grouped.get(r.userId);
    if (list) list.push(r);
    else grouped.set(r.userId, [r]);
  }

  for (const [userId, list] of grouped) {
    byUser.set(
      userId,
      list
        // MEST KOMPLETTA först — det är den raden som är värd att öppna appen för
        // ("12 kort kvar"). Lika andel → fler ägda kort vinner.
        .sort((a, b) => b.owned / b.total - a.owned / a.total || b.owned - a.owned)
        .slice(0, MAX_SET_PROGRESS)
        .map((r) => ({
          setName: r.setName,
          owned: r.owned,
          total: r.total,
          url: `${APP_URL}/sets/${r.setId}`,
        }))
    );
  }
  return byUser;
}

/**
 * `collectionItemId → { varans identitet, produktlänk }` för HELA mottagarlistan.
 *
 * Två frågor, aldrig två per mottagare. Behövs till två saker samtidigt:
 * dedupen av movers (som är per VARA, inte per post) och länken från en mover
 * till produktsidan — `computeCollectionValue().movers` bär bara postens id.
 */
async function loadCollectionRefs(userIds: string[]): Promise<Map<string, CollectionRef>> {
  const refs = new Map<string, CollectionRef>();
  if (userIds.length === 0) return refs;

  const items = await prisma.collectionItem.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, cardId: true, productId: true, product: { select: { slug: true } } },
  });

  // Singel-kort länkas till kortets BILLIGASTE produkt — samma val som
  // /samling gör, så mejlet och sidan landar på samma produktsida.
  const cardIds = Array.from(
    new Set(items.map((i) => i.cardId).filter((v): v is string => v != null))
  );
  const slugByCard = new Map<string, string>();
  if (cardIds.length > 0) {
    const cardProducts = await prisma.product.findMany({
      where: { cardId: { in: cardIds }, hiddenAt: null },
      select: { cardId: true, slug: true, lowestPriceOre: true },
    });
    const best = new Map<string, number>();
    for (const p of cardProducts) {
      if (!p.cardId) continue;
      const lp = p.lowestPriceOre ?? Number.MAX_SAFE_INTEGER;
      const prev = best.get(p.cardId);
      if (prev == null || lp < prev) {
        best.set(p.cardId, lp);
        slugByCard.set(p.cardId, p.slug);
      }
    }
  }

  for (const i of items) {
    const slug = i.product?.slug ?? (i.cardId ? slugByCard.get(i.cardId) ?? null : null);
    refs.set(i.id, {
      key: i.cardId ? `card:${i.cardId}` : i.productId ? `product:${i.productId}` : `item:${i.id}`,
      url: slug ? productUrl(slug) : null,
    });
  }
  return refs;
}

export async function runWeeklyDigest(
  now = new Date(),
  opts?: {
    force?: boolean;
    dryRun?: boolean;
    onlyEmail?: string;
    /**
     * Får varje FÄRDIGBYGGT brev innan det skickas (eller i stället för, vid
     * torrkörning). Finns för att kunna GRANSKA brevet — 2026-08-16 gick ett
     * skarpt utskick ut med relativa länkar och trasig logotyp, och det gick
     * inte att se förrän det låg i en inkorg. En torrkörning som bara räknar
     * mottagare säger inget om hur brevet SER UT.
     */
    onBuilt?: (email: string, mail: { subject: string; html: string; text: string }) => void;
  }
): Promise<WeeklyDigestResult> {
  const empty: WeeklyDigestResult = {
    skippedWrongDay: false,
    candidates: 0,
    sent: 0,
    skippedOptedOut: 0,
    skippedNoContent: 0,
    failed: 0,
    underMarketCount: 0,
  };

  if (!opts?.force && now.getUTCDay() !== DIGEST_WEEKDAY) {
    console.log(
      `[weekly-digest] Fel veckodag (UTC ${now.getUTCDay()}, väntar på ${DIGEST_WEEKDAY}) — hoppar över.`
    );
    return { ...empty, skippedWrongDay: true };
  }

  // ⛔ FÖRST AV ALLT: kan vi ens signera en avregistreringslänk? Kastar den här
  // avbryts steget innan ett enda mejl gått iväg — se filens topp.
  requireUnsubscribeSecret();

  // ⛔ KONSOLLÄGE ÄR INTE ETT UTSKICK — och här är det värre än vanligt. Utan
  // RESEND_API_KEY (och utan NODE_ENV=production, vilket tsx i Actions inte har)
  // loggar `sendMail` mejlet och returnerar UTAN fel → loopen nedan stämplar
  // `weeklyDigestSentAt` på varenda mottagare och bränner veckans utskick tyst.
  // Exakt den fällan slog till vid Discord-provutskicket 2026-08-14.
  if (!opts?.dryRun && (process.env.EMAIL_MODE === "console" || !process.env.RESEND_API_KEY)) {
    throw new Error(
      "Mailern går i konsolläge (EMAIL_MODE=console eller RESEND_API_KEY saknas) — " +
        "veckobrevet avbryts hellre än stämplar alla som mejlade utan att skicka något. " +
        "Kör med --dry-run lokalt, eller via scrape-all.yml där nyckeln är en secret."
    );
  }

  const weekAgo = utcDaysAgo(7);
  const resendCutoff = new Date(now.getTime() - RESEND_WINDOW_DAYS * 864e5);

  const users = await prisma.user.findMany({
    where: {
      // ⛔ Bara VERIFIERADE adresser. En overifierad adress kan vara felstavad
      // eller någon annans — den har aldrig bevisat att den vill höra av oss.
      emailVerifiedAt: { not: null },
      email: { not: "" },
      OR: [{ weeklyDigestSentAt: null }, { weeklyDigestSentAt: { lt: resendCutoff } }],
    },
    select: { id: true, name: true, email: true, notificationSettings: true },
    orderBy: { createdAt: "asc" },
  });

  const result: WeeklyDigestResult = { ...empty, candidates: users.length };

  let recipients = users.filter((u) => {
    const s = parseNotificationSettings(u.notificationSettings);
    // `email` är master-toggeln, `weekly` den egna. Båda måste vara på.
    if (s.email && s.weekly) return true;
    result.skippedOptedOut++;
    return false;
  });
  const afterOptOut = recipients.length;
  if (opts?.onlyEmail) {
    const only = opts.onlyEmail.toLowerCase();
    recipients = recipients.filter((u) => u.email.toLowerCase() === only);
  }

  const pulse = await loadPlatformPulse(weekAgo, now);
  result.underMarketCount = pulse.underMarketCount;
  const pulseHasContent =
    pulse.underMarketCount > 0 || pulse.restockCount > 0 || pulse.newSetCount > 0;

  if (recipients.length === 0) {
    // ⛔ SÄG VILKET FILTER SOM TÖMDE LISTAN. Raden löd förut alltid "0 mottagare
    // efter opt-out", vilket 2026-08-16 pekade felsökningen mot notisinställningar
    // när den verkliga orsaken var att `--to=`-adressen inte ens fanns bland
    // kandidaterna (overifierad e-post). Ett provutskick som tyst rapporterar fel
    // orsak är värre än inget meddelande alls.
    const why = opts?.onlyEmail
      ? afterOptOut === 0
        ? "alla kandidater har avregistrerat sig"
        : `--to=${opts.onlyEmail} matchade ingen av ${afterOptOut} mottagare ` +
          `(adressen är overifierad, redan mejlad den här veckan, eller finns inte)`
      : "alla kandidater har avregistrerat sig";
    console.log(
      `[weekly-digest] ${result.candidates} kandidater · 0 mottagare — ${why} · ` +
        `${pulse.underMarketCount} varor under marknadspris.`
    );
    return result;
  }

  // ---- Batch-laddning: EN fråga per datatyp för HELA mottagarlistan ----
  // ⛔ Aldrig en fråga per mottagare i en loop — det är samma misstag som höll
  // computen vaken dygnet runt 2026-07-07, fast med 65 varv i stället för tusentals.
  const ids = recipients.map((u) => u.id);
  const [watchItems, setWatches, collectionOwners] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { userId: { in: ids }, isPaused: false },
      select: {
        userId: true,
        productId: true,
        product: {
          select: {
            title: true,
            slug: true,
            setId: true,
            category: true,
            lowestPriceOre: true,
            imageUrl: true,
            hiddenAt: true,
          },
        },
      },
    }),
    prisma.setWatch.findMany({ where: { userId: { in: ids } }, select: { userId: true, setId: true } }),
    prisma.collectionItem.findMany({
      where: { userId: { in: ids } },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);

  const visibleWatches = watchItems.filter((w) => w.product && w.product.hiddenAt === null);
  const watchedProductIds = Array.from(new Set(visibleWatches.map((w) => w.productId)));
  const watchedSetIds = Array.from(new Set(setWatches.map((s) => s.setId)));
  const hasCollection = new Set(collectionOwners.map((c) => c.userId));

  // Prisfall: samma definition som katalogens "Största prisfall" — dagliga
  // PriceSnapshots genom computePriceChange7d, inte en egen uträkning.
  const snapshots = watchedProductIds.length
    ? await prisma.priceSnapshot.findMany({
        where: { productId: { in: watchedProductIds }, date: { gte: weekAgo } },
        select: { productId: true, date: true, avgPrice: true },
        orderBy: { date: "asc" },
      })
    : [];
  const snapsByProduct = new Map<string, { date: Date; avgPrice: number }[]>();
  for (const s of snapshots) {
    const list = snapsByProduct.get(s.productId);
    if (list) list.push(s);
    else snapsByProduct.set(s.productId, [s]);
  }
  const changeByProduct = new Map<string, number>();
  for (const [productId, snaps] of snapsByProduct) {
    const { percent } = computePriceChange7d(snaps);
    if (percent != null) changeByProduct.set(productId, percent);
  }

  const restockWhereOr = [
    ...(watchedProductIds.length ? [{ productId: { in: watchedProductIds } }] : []),
    ...(watchedSetIds.length ? [{ product: { setId: { in: watchedSetIds } } }] : []),
  ];
  const restockEvents = restockWhereOr.length
    ? await prisma.restockEvent.findMany({
        where: {
          detectedAt: { gte: weekAgo },
          newStatus: "IN_STOCK",
          oldStatus: { not: "IN_STOCK" },
          OR: restockWhereOr,
        },
        select: {
          productId: true,
          price: true,
          detectedAt: true,
          retailer: { select: { name: true } },
          product: {
            select: {
              title: true,
              slug: true,
              setId: true,
              category: true,
              imageUrl: true,
              hiddenAt: true,
            },
          },
        },
        orderBy: { detectedAt: "desc" },
        take: RESTOCK_EVENT_CAP,
      })
    : [];

  // Set-komplettering och samlingens identiteter — också EN batch för hela listan,
  // och bara för dem som faktiskt har poster (ingen fråga för tomma samlingar).
  const collectionUserIds = ids.filter((id) => hasCollection.has(id));
  const [setProgressByUser, collectionRefs] = await Promise.all([
    loadSetProgress(collectionUserIds),
    loadCollectionRefs(collectionUserIds),
  ]);

  // ---- Bygg och skicka ----
  for (const user of recipients) {
    const myWatches = visibleWatches.filter((w) => w.userId === user.id);
    const myProductIds = new Set(myWatches.map((w) => w.productId));
    const mySetIds = new Set(setWatches.filter((s) => s.userId === user.id).map((s) => s.setId));

    const drops: DigestDrop[] = myWatches
      .map((w) => ({ w, percent: changeByProduct.get(w.productId) }))
      .filter((x): x is { w: (typeof myWatches)[number]; percent: number } =>
        x.percent != null && x.percent <= -MIN_DROP_PERCENT
      )
      .sort((a, b) => a.percent - b.percent)
      .slice(0, MAX_DROPS)
      .map(({ w, percent }) => ({
        title: w.product!.title,
        url: productUrl(w.product!.slug),
        priceOre: w.product!.lowestPriceOre,
        percent,
        imageUrl: mailImage(w.product!.imageUrl),
      }));

    const seenRestock = new Set<string>();
    const restocks: DigestRestock[] = [];
    for (const ev of restockEvents) {
      if (restocks.length >= MAX_RESTOCKS) break;
      const p = ev.product;
      if (!p || p.hiddenAt !== null) continue;
      const viaProduct = myProductIds.has(ev.productId);
      // Set-bevakningen gäller SEALED, precis som larmvägen — annars hade brevet
      // lovat något set-bevakningen aldrig larmar om.
      const viaSet = p.setId != null && mySetIds.has(p.setId) && isSealedCategory(p.category);
      if (!viaProduct && !viaSet) continue;
      // ⛔ EN RAD PER VARA, INTE PER BUTIK. Nyckeln bar förut butiksnamnet, så
      // samma låda som fyllts på hos två butiker blev två rader — i granskningen
      // 2026-08-16 låg "Ascended Heroes Elite Trainer Box" två gånger i en lista
      // på fem, och läste som samma dubblettbugg som movers hade. Listan svarar på
      // "vad är tillbaka?", inte "hos vilka butiker?"; butiksvalet gör man på
      // produktsidan, där ALLA butiker syns med aktuellt pris.
      // Händelserna är sorterade `detectedAt desc`, så den rad som behålls är den
      // SENASTE påfyllningen — den färskaste uppgiften, inte den billigaste (ett
      // pris ur en gammal händelse hade kunnat vara inaktuellt).
      if (seenRestock.has(ev.productId)) continue;
      seenRestock.add(ev.productId);
      restocks.push({
        title: p.title,
        url: productUrl(p.slug),
        retailerName: ev.retailer.name,
        priceOre: ev.price,
        imageUrl: mailImage(p.imageUrl),
      });
    }

    let collection: {
      totalValueOre: number;
      changeOre: number | null;
      changePercent: number | null;
      movers: DigestMover[];
    } | null = null;
    if (hasCollection.has(user.id)) {
      // ⛔ Bara för den som HAR poster: computeCollectionValue drar flera frågor
      // och hela prisserien, och för en tom samling hade den kostat det för noll
      // innehåll. Återanvänds rakt av — den bygger redan en ÄKTA daglig kurva ur
      // PriceSnapshot och returnerar movers; inget nytt snapshot-bord byggs här.
      const value = await computeCollectionValue(user.id);
      // 0 kr är inget värde ("–" betyder att vi inte vet) → hoppa över avsnittet.
      if (value.totalValue > 0) {
        const series = value.valueOverTime;
        let changeOre: number | null = null;
        let changePercent: number | null = null;
        // ⛔ INDEX bakåt, inte datumjämförelse: serien är en punkt per dygn, och
        // att räkna på position gör oss immuna mot om nyckeln råkar vara lokal
        // eller UTC. Saknas åtta punkter finns ingen sjudagarsförändring — då
        // visas ingen alls, hellre det än en påhittad nolla.
        if (series.length >= 8) {
          const last = series[series.length - 1].value;
          const prev = series[series.length - 8].value;
          if (prev > 0) {
            changeOre = last - prev;
            changePercent = Math.round(((last - prev) / prev) * 1000) / 10;
          }
        }
        collection = {
          totalValueOre: value.totalValue,
          changeOre,
          changePercent,
          movers: pickMovers(value.movers, collectionRefs),
        };
      }
    }

    const setProgress = setProgressByUser.get(user.id) ?? [];

    const hasContent =
      !!collection ||
      drops.length > 0 ||
      restocks.length > 0 ||
      setProgress.length > 0 ||
      pulseHasContent;
    if (!hasContent) {
      // ⛔ INGEN STÄMPEL: fick hen inget brev ska nästa vecka pröva på nytt.
      result.skippedNoContent++;
      continue;
    }

    const mail = weeklyDigestEmail({
      name: user.name,
      unsubscribeUrl: unsubscribeUrl(APP_URL, user.id, "weekly"),
      // ⛔ BAS-URL:EN INJICERAS AV JOBBET — mallen läser inte env själv. Ett enda
      // ställe att få tomt (och att laga) i stället för två, och testerna kan
      // därför bevisa att varje länk i brevet är absolut.
      appUrl: APP_URL,
      collection: collection ?? undefined,
      drops,
      restocks,
      // Tomma avsnitt skickas som tom lista → mallen utelämnar dem. Ingen utfyllnad.
      setProgress: setProgress.length > 0 ? setProgress : undefined,
      pulse,
    });

    // Granskningskroken körs för BÅDA lägena: brevet som skickas är exakt det
    // som går att inspektera, aldrig en rekonstruktion.
    opts?.onBuilt?.(user.email, mail);

    if (opts?.dryRun) {
      console.log(`  [torrkörning] ${user.email} — "${mail.subject}"`);
      result.sent++;
      continue;
    }

    try {
      await sendMail({
        to: user.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        // Ett-klicks-avanmälan i mejlklienten. Samma signerade URL som sidfoten.
        unsubscribeUrl: unsubscribeUrl(APP_URL, user.id, "weekly"),
        // Massutskick → Brevo-lanen (300/dygn) när nyckeln finns, annars Resend.
        lane: "bulk",
      });
      // ⛔ Stämplas EFTER lyckat utskick — annars tystar ett tillfälligt mejlfel
      // användaren för hela veckan (samma regel som pro-expiry-notice).
      await prisma.user.update({
        where: { id: user.id },
        data: { weeklyDigestSentAt: now },
      });
      result.sent++;
    } catch (e) {
      console.error(`[weekly-digest] Kunde inte mejla ${user.email}:`, e);
      result.failed++;
      // Permanent fel = adressen/innehållet blir aldrig rätt. Fortsätt inte blint
      // och samla på hårda studsar — samma regel som dispatchPendingAlerts.
      if (isPermanentMailError(e)) {
        console.error("[weekly-digest] Permanent mejlfel — avbryter resten av utskicket.");
        break;
      }
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  console.log(
    `[weekly-digest] ${result.candidates} kandidater · ${result.sent} brev · ` +
      `${result.skippedOptedOut} avregistrerade · ${result.skippedNoContent} utan innehåll · ` +
      `${result.failed} fel · ${pulse.underMarketCount} varor under marknadspris ` +
      `(minst ${pulse.minDiscountPercent} %, ${pulse.examples.length} exempel) · ` +
      `${pulse.restockCount} restocks · ${pulse.newSetCount} nya set.`
  );
  return result;
}
