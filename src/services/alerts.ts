/** Alerttjänster: skapande, listning, läsmarkering samt pris-/restock-kontroller. */
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { isBlockedListingLanguage } from "@/lib/listing-language";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
import { proUserWhere } from "@/lib/plan";
import { judgePriceAlert, priceAlertPolicy, type PriceAlertVerdict } from "@/lib/price-alert-rule";
import { priceAlertsPaused } from "@/lib/price-alerts-pause";
import { restockAlertsPaused } from "@/lib/restock-alerts-pause";
import { isSealedCategory } from "@/lib/product-category";
// Lokalt bruk (checkRestockAlerts nedan). Re-exporten längre ner är för utomstående
// importvägar — `export … from` binder INTE namnen i den här modulens scope.
import { FLAP_WINDOW_HOURS, evaluateStockFlap, flapPolicy } from "@/lib/stock-flap";
import type { AlertChannel, AlertType, Prisma, StockStatus } from "@prisma/client";

function formatSek(ore: number): string {
  return `${(ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kr`;
}

/**
 * Beskedet för en lagerövergång — samma tre fall som mejlmallarna (buildAlertEmail):
 * öppnad förhandsbokning, släpp (förhandsbokning → riktigt lager) och påfyllning.
 * Okänd övergång (larm skapade före kolumnerna fanns) faller tillbaka på påfyllning,
 * som är den överlägset vanligaste.
 */
export function stockAlertMessage(
  title: string,
  fromStatus: StockStatus | null,
  toStatus: StockStatus | null
): string {
  if (toStatus === "PREORDER") return `${title} går nu att förhandsboka!`;
  if (fromStatus === "PREORDER") return `${title} har släppts och finns nu i lager!`;
  return `${title} finns i lager igen!`;
}

/**
 * FLAPP-DÄMPNINGEN BOR I `@/lib/stock-flap` sedan 2026-08-11 — ren och DB-fri, så
 * Discord-snabbfilen kan använda EXAKT samma dom utan att läsa RestockEvent (den
 * lanen är DB-fri med flit och håller sin egen historik i Actions-cachen).
 * Re-exporteras här så alla befintliga importvägar (och tests/unit/alerts.test.ts)
 * är oförändrade. Läs motiveringen och facit-siffrorna i den filen.
 */
export {
  FLAP_WINDOW_HOURS,
  evaluateStockFlap,
  flapPolicy,
  type FlapPolicy,
} from "@/lib/stock-flap";

export interface CreateAlertInput {
  userId: string;
  productId?: string;
  type: AlertType;
  message: string;
  channel?: AlertChannel;
}

export async function createAlert(input: CreateAlertInput) {
  return prisma.alert.create({
    data: {
      userId: input.userId,
      productId: input.productId,
      type: input.type,
      message: input.message,
      channel: input.channel ?? "IN_APP",
    },
  });
}

export async function listAlerts(
  userId: string,
  opts: { page?: number; pageSize?: number } = {}
) {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const [items, total] = await prisma.$transaction([
    prisma.alert.findMany({
      where: { userId },
      include: {
        product: { select: { id: true, title: true, slug: true, imageUrl: true } },
      },
      orderBy: { triggeredAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.alert.count({ where: { userId } }),
  ]);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function markRead(userId: string, alertId: string) {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert || alert.userId !== userId) {
    throw new ServiceError(404, "Aviseringen hittades inte.");
  }
  return prisma.alert.update({
    where: { id: alertId },
    data: { status: "READ" },
  });
}

/** En köpbar offer: i lager, direktlänk, pris > 0 — det produktsidan visar som rubrikpris. */
export interface BuyableOffer {
  id: string;
  productId: string;
  price: number;
  url: string;
  retailerId: string;
  retailer: { name: string };
}

/**
 * Lägsta KÖPBARA offer per produkt, i EN fråga. Samma urval som produktsidans
 * rubrikpris (`computeLowestPrice` + `isDirectOfferUrl`): i lager, direktlänk, > 0 kr.
 * ⛔ En OUT_OF_STOCK-offer är per definition en uppskattning (CM-guiden märks så) och
 *    får aldrig larma — det var defekt 1 (larmet "nu 1 338 kr" ur en slutsåld offer på
 *    en produkt vars verkliga lägsta pris var 2 665 kr).
 */
export async function lowestBuyableByProduct(productIds: string[]): Promise<Map<string, BuyableOffer>> {
  const map = new Map<string, BuyableOffer>();
  if (productIds.length === 0) return map;
  const offers = await prisma.offer.findMany({
    where: { productId: { in: productIds }, stockStatus: "IN_STOCK", price: { gt: 0 } },
    select: {
      id: true,
      productId: true,
      price: true,
      url: true,
      retailerId: true,
      retailer: { select: { name: true } },
    },
    orderBy: { price: "asc" },
  });
  for (const o of offers) {
    if (map.has(o.productId) || o.price == null || !isDirectOfferUrl(o.url)) continue;
    map.set(o.productId, { ...o, price: o.price });
  }
  return map;
}

export async function lowestBuyableOffer(productId: string): Promise<BuyableOffer | null> {
  return (await lowestBuyableByProduct([productId])).get(productId) ?? null;
}

export interface PriceAlertCheckResult {
  triggered: number;
  /** Varför bevakningar INTE larmade, per skäl (`PriceAlertSkipReason`). */
  skipped: Record<string, number>;
}

/** Larmradens text — SAMMA tal som mejlet och pushen (defekt 3 var tre olika tal). */
export function priceAlertMessage(
  title: string,
  verdict: Extract<PriceAlertVerdict, { fire: true }>,
  priceOre: number,
  storeName: string
): string {
  if (verdict.kind === "PRICE_TARGET") {
    return `${title} har nått ditt målpris: nu ${formatSek(priceOre)} hos ${storeName}.`;
  }
  return (
    `${title} har sjunkit till ${formatSek(priceOre)} hos ${storeName} ` +
    `(−${Math.round(verdict.percent)} % från ${formatSek(verdict.baselineOre)}).`
  );
}

/**
 * Kontrollerar prislarm för en produkt. Anropas när produktens pris KAN ha fallit
 * (nattkedjans/prisjobbens svep över bevakade produkter, eller en prissänknings-hit
 * från Discord-lanen) — aldrig per offer-rörelse i hela katalogen.
 *
 * DOMEN (`src/lib/price-alert-rule.ts`) tas på produktens LÄGSTA KÖPBARA pris, inte på
 * offern som råkade röra sig; `previousOre` är det pris användaren senast SÅG
 * (produktens cachade `lowestPriceOre` om anroparen inte vet bättre) och är prisfall-
 * lägets utgångsläge före första larmet. Varje larm sätter bevakningens SPÄRR
 * (`priceAlertFiredOre`), som `rearmPriceAlerts()` släpper när priset återhämtat sig
 * — ett larm per gång målet nås, inte per rörelse under målet (defekt 2).
 *
 * Larmraden bär `priceOre` + `retailerId`, så mejl och push visar exakt det priset hos
 * exakt den butiken (defekt 3 och 6: "0 kr" kan inte uppstå — priset är > 0 per urval).
 *
 * ⛔ PAUSAT LÄGE: inga rader skapas alls. Grinden ligger FÖRST, före varje fråga.
 */
export async function checkPriceAlerts(
  productId: string,
  opts: {
    /** Priset användaren senast såg (öre). `undefined` = läs produktens cachade lägstapris. */
    previousOre?: number | null;
    /** Redan framräknad lägsta köpbara offer (anroparen har den) — sparar en fråga. */
    lowest?: BuyableOffer | null;
  } = {}
): Promise<PriceAlertCheckResult> {
  const none: PriceAlertCheckResult = { triggered: 0, skipped: {} };
  if (priceAlertsPaused()) return none;
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, title: true, slug: true, hiddenAt: true, lowestPriceOre: true },
  });
  // Gömda produkter larmar aldrig — samma regel som lagerlarmen (isHiddenFromAlerts).
  if (!product || product.hiddenAt != null) return none;

  const watchers = await prisma.watchlistItem.findMany({
    where: {
      productId,
      priceAlert: true,
      isPaused: false,
      // Prislarm är en Pro-förmån (jfr restock-larm). Admins räknas som Pro — se isPro().
      user: proUserWhere(),
    },
    select: { id: true, userId: true, targetPrice: true, priceAlertFiredOre: true },
  });
  if (watchers.length === 0) return none;

  const lowest = opts.lowest === undefined ? await lowestBuyableOffer(productId) : opts.lowest;
  const skipped: Record<string, number> = {};
  const skip = (why: string, n = 1) => {
    skipped[why] = (skipped[why] ?? 0) + n;
  };
  if (!lowest) {
    skip("no-price", watchers.length);
    return { triggered: 0, skipped };
  }
  const previousOre = opts.previousOre === undefined ? product.lowestPriceOre : opts.previousOre;
  const policy = priceAlertPolicy();
  const now = new Date();
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  let triggered = 0;
  for (const w of watchers) {
    const verdict = judgePriceAlert(w, lowest.price, previousOre, policy);
    if (!verdict.fire) {
      skip(verdict.reason);
      continue;
    }
    triggered++;
    writes.push(
      prisma.alert.create({
        data: {
          userId: w.userId,
          productId,
          retailerId: lowest.retailerId,
          type: verdict.kind,
          priceOre: lowest.price,
          message: priceAlertMessage(product.title, verdict, lowest.price, lowest.retailer.name),
          channel: "EMAIL",
        },
      }),
      prisma.watchlistItem.update({
        where: { id: w.id },
        data: { priceAlertFiredOre: lowest.price, priceAlertFiredAt: now },
      })
    );
  }
  if (writes.length > 0) await prisma.$transaction(writes);
  return { triggered, skipped };
}

/**
 * Släpper prislarmens spärrar där priset återhämtat sig: målpris-läget när det cachade
 * lägstapriset åter ligger ÖVER målet, prisfall-läget när det stigit `rearmPercent` över
 * larmnivån. EN fråga, körs efter `recomputeProductPriceCache()` i prisjobben. Rör bara
 * rader med satt spärr (ett fåtal). Returnerar antal släppta.
 */
export async function rearmPriceAlerts(): Promise<number> {
  // Heltal (samma skäl som shouldRearm): 100 + procent, jämfört mot pris × 100.
  const factor = Math.round(100 + priceAlertPolicy().rearmPercent);
  return prisma.$executeRaw`
    UPDATE "WatchlistItem" w
    SET "priceAlertFiredOre" = NULL, "priceAlertFiredAt" = NULL
    FROM "Product" p
    WHERE p.id = w."productId"
      AND w."priceAlertFiredOre" IS NOT NULL
      AND p."lowestPriceOre" IS NOT NULL AND p."lowestPriceOre" > 0
      AND (
        (w."targetPrice" IS NOT NULL AND p."lowestPriceOre" > w."targetPrice")
        OR (w."targetPrice" IS NULL AND p."lowestPriceOre" * 100 >= w."priceAlertFiredOre" * ${factor})
      )
  `;
}

/**
 * Kontrollerar restock-larm för en produkt när påfyllning upptäckts.
 * Restock-larm är en Pro-förmån: mottagare = PRO-bevakare av produkten
 * (restockAlert) UNION Pro-användare som valt att få ALLA restocks
 * (notificationSettings.allRestocks=true). Gratisanvändare får inga restock-larm.
 * Skapar Alert (EMAIL) per unik användare.
 *
 * ponytail: ett mejl per restock per mottagare. Vid stora drop-vågor kan en
 * "alla restocks"-prenumerant få många mejl — lägg en daglig digest om det blir
 * ett problem (samla restocks under körningen och skicka en sammanfattning).
 */
export async function checkRestockAlerts(
  productId: string,
  retailerId?: string,
  // Lagerövergången bakom larmet. Utelämnad = klassisk påfyllning (OUT→IN); det är
  // vad alla anropare gjorde före 2026-07-25 och vad copyn defaultar till.
  transition?: { from?: StockStatus | null; to?: StockStatus | null }
) {
  // ⛔ PAUSAT LÄGE: inga rader skapas alls — se restock-alerts-pause.ts för varför
  // grinden ligger här och inte vid utskicket. Först av allt, före produktuppslaget:
  // nattkedjan gör hundratals anrop hit och Neon debiteras per vaken tid.
  if (restockAlertsPaused()) return { triggered: 0 };
  const product = await prisma.product.findUnique({
    where: { id: productId },
    // setId + category + setnamn: set-bevakarna nedan avgörs på dem, och namnet
    // följer med i mejlet som skälet till att larmet kom.
    select: {
      id: true,
      title: true,
      slug: true,
      setId: true,
      category: true,
      set: { select: { name: true } },
    },
  });
  if (!product) return { triggered: 0 };
  // Blockade språk (kinesiska/koreanska) larmar vi inte på "for now". Japanska = OK.
  if (isBlockedListingLanguage(product.title)) return { triggered: 0 };

  const fromStatus = transition?.from ?? null;
  const toStatus = transition?.to ?? null;

  // Restock-cooldown = kort ANTI-BURST, inte huvudskyddet. Rotation-spammet
  // (falska OUT→IN när en produkt roterar ur/in i feeden) stoppas numera vid källan:
  // frånvaro-försoningen sätter UNKNOWN (ej OUT_OF_STOCK) och UNKNOWN→IN larmar
  // aldrig (2026-07-07). Fönstret här dämpar bara snabb explicit flapp (feed som
  // växlar slut/i-lager på minuter). KORT med flit: billiga heta produkter kan ha
  // flera ÄKTA restocks samma dag och varje sådan ska larma.
  let cooldownH = Number(process.env.RESTOCK_ALERT_COOLDOWN_HOURS ?? 2);

  // Flapp-dämpning: blinkar tystas helt, droppande butiker får dygnscooldown.
  // Läser butikens egen övergångshistorik för produkten — se evaluateStockFlap.
  if (retailerId) {
    const now = new Date();
    const recent = await prisma.restockEvent.findMany({
      where: {
        productId,
        retailerId,
        detectedAt: { gte: new Date(now.getTime() - FLAP_WINDOW_HOURS * 3600_000) },
      },
      select: { oldStatus: true, detectedAt: true },
      orderBy: { detectedAt: "desc" },
    });
    const flap = evaluateStockFlap(recent, toStatus, now, flapPolicy());
    if (flap.blip) return { triggered: 0 };
    cooldownH = Math.max(cooldownH, flap.cooldownHours);
  }

  if (cooldownH > 0 && retailerId) {
    const recent = await prisma.alert.findFirst({
      where: {
        type: "RESTOCK",
        productId,
        retailerId,
        // Scopad till SAMMA slutstatus: en butik som öppnar förhandsbokning och
        // sedan släpper varan inom fönstret ska larma TVÅ gånger — det är två olika
        // besked. Utan detta åt förhandsbokningslarmet släpp-larmet.
        toStatus,
        triggeredAt: { gte: new Date(Date.now() - cooldownH * 3600_000) },
      },
      select: { id: true },
    });
    if (recent) return { triggered: 0 };
  }

  // SET-BEVAKARE: "bevaka hela setet" är en STÅENDE regel, så den utvärderas här
  // och inte som WatchlistItem-rader vid klicktillfället — annars hade den missat
  // varje sealed-SKU som auto-importen skapat sedan dess, vilket är själva poängen.
  // Bara sealed: singlar/tillbehör restockar inte i butiksfeeden, och rubriken
  // lovar sealed-larm. Produkter utan set (färska auto-importer får sitt setId
  // först av nattens sealed-import) faller igenom tills de fått sin etikett.
  const setWatchApplies = !!product.setId && isSealedCategory(product.category);

  const [watchers, allSubs, setWatchers] = await Promise.all([
    prisma.watchlistItem.findMany({
      // Restock-larm är Pro-only — även bevakade produkter larmar bara för Pro.
      where: { productId, restockAlert: true, isPaused: false, user: proUserWhere() },
      select: { userId: true },
    }),
    prisma.user.findMany({
      // "Alla restocks" är också en Pro-förmån.
      where: {
        notificationSettings: { path: ["allRestocks"], equals: true },
        ...proUserWhere(),
      },
      select: { id: true },
    }),
    setWatchApplies
      ? prisma.setWatch.findMany({
          // Pro-grinden finns redan i addSetWatch, men mottagarfrågan får inte
          // LITA på det: en användare kan ha varit Pro när raden skapades och
          // fallit till FREE sedan dess (RevenueCat EXPIRATION).
          where: { setId: product.setId!, user: proUserWhere() },
          select: { userId: true },
        })
      : Promise.resolve([] as { userId: string }[]),
  ]);

  const userIds = new Set<string>();
  for (const w of watchers) userIds.add(w.userId);
  for (const u of allSubs) userIds.add(u.id);
  for (const s of setWatchers) userIds.add(s.userId);
  if (userIds.size === 0) return { triggered: 0 };

  // Skälsraden i mejlet gäller den som INTE bevakar produkten själv: bevakar man
  // varan är "du bevakar den här varan" ingen nyhet, men får man plötsligt mejl om
  // en låda man aldrig rört är setnamnet hela förklaringen.
  const directWatchers = new Set(watchers.map((w) => w.userId));
  const setReasonFor = new Set(
    setWatchers.map((s) => s.userId).filter((id) => !directWatchers.has(id))
  );
  const setName = product.set?.name ?? null;

  // Tre olika besked under samma AlertType. "igen" gäller BARA påfyllningen: ett
  // släpp har aldrig varit i lager förut, och en öppnad förhandsbokning går inte att
  // få hem än. In-app-listan visar det här meddelandet, mejlet väljer mall på samma
  // övergång (buildAlertEmail).
  const message = stockAlertMessage(product.title, fromStatus, toStatus);
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const userId of userIds) {
    writes.push(
      // EMAIL-kanal → dispatchPendingAlerts skickar mejl (default IN_APP gjorde
      // att restocks aldrig mejlades). retailerId = butiken som fick lager igen →
      // mejlets "Köp nu" länkar direkt dit (buildAlertEmail).
      prisma.alert.create({
        data: {
          userId,
          productId,
          retailerId,
          type: "RESTOCK",
          fromStatus,
          toStatus,
          // Skälet skrivs NU, när vi vet det. Att räkna ut det vid utskick hade
          // varit en gissning: användaren kan ha tagit bort set-bevakningen mellan
          // larm och mejl, och då hade mejlet påstått fel anledning.
          reasonSetName: setReasonFor.has(userId) ? setName : null,
          message,
          channel: "EMAIL",
        },
      })
    );
  }
  await prisma.$transaction(writes);
  return { triggered: userIds.size };
}

/**
 * Feed-först-larm för en RÅ butiksannons (StoreListing) som INTE fanns som Offer
 * — antingen en helt ny produkt (NEW_LISTING) eller en restock av något vi inte har
 * som Offer (RESTOCK). Mottagare = Pro-användare med "Alla restocks/nya produkter"
 * påslaget (notificationSettings.allRestocks=true) UNION Pro-bevakare av produkten
 * (WatchlistItem.restockAlert) när annonsen auto-importerats till en katalogprodukt.
 *
 * BEVAKARNA: kommentaren här sa förr att watchlist-bevakare "inte kan gälla" (ingen
 * katalogprodukt att bevaka). Det slutade gälla när auto-importen (ensureListingProduct)
 * började LÄNKA annonsen till en BEFINTLIG produkt: en butik som börjar sälja något
 * någon redan bevakar kommer in här, inte via offer-diffen (URL:en har ingen Offer
 * ännu). Utan bevakarna blev den händelsen tyst för alla som stängt av "Alla restocks"
 * — mätt 2026-07-25: Pitch Black Booster Bundle + Mega Greninja ex dök upp i lager hos
 * Samlarhobby 07-19 utan att bevakaren fick något (och utan RestockEvent-rad, så det
 * syntes inte ens i restock-historiken).
 */
export async function checkListingAlerts(
  listing: { id: string; title: string; retailerId: string; productId?: string | null },
  kind: "NEW_LISTING" | "RESTOCK" | "PREORDER",
  // Lagerövergången bakom RESTOCK-varianten. En auto-importerad annons länkas till
  // VÅR produkt (storeListingId blir null) → mejlet byggs då på produkten och kan
  // inte längre läsa annonsens status. Utan detta blev ett släpp (PREORDER → i lager)
  // ett "Åter i lager"-mejl för något som aldrig varit i lager.
  transition?: { from?: StockStatus | null; to?: StockStatus | null }
) {
  // ⛔ PAUSAT LÄGE — samma grind som checkRestockAlerts. Gäller ALLA tre bespeden
  // härifrån (NEW_LISTING/RESTOCK/PREORDER): de levereras av samma Pro-funktion och
  // samma inställning ("Alla restocks/nya produkter") som pause-mejlet gällde.
  if (restockAlertsPaused()) return { triggered: 0 };
  // Blockade språk (kinesiska/koreanska) larmar vi inte på "for now". Japanska = OK.
  if (isBlockedListingLanguage(listing.title)) return { triggered: 0 };

  // SET-BEVAKARE: den här vägen är den VIKTIGASTE för set-bevakningen. En helt ny
  // sealed-SKU (förhandsbox som dyker upp hos en butik) har ingen Offer ännu och
  // kommer alltså in HÄR, inte via offer-diffen — precis det man bevakar ett set
  // för. Utan uppslaget hade set-bevakningen bara larmat om varor vi redan kände.
  const product = listing.productId
    ? await prisma.product.findUnique({
        where: { id: listing.productId },
        select: { setId: true, category: true, set: { select: { name: true } } },
      })
    : null;
  const setId = product && isSealedCategory(product.category) ? product.setId : null;

  const [allSubs, watchers, setWatchers] = await Promise.all([
    prisma.user.findMany({
      where: {
        notificationSettings: { path: ["allRestocks"], equals: true },
        ...proUserWhere(),
      },
      select: { id: true },
    }),
    listing.productId
      ? prisma.watchlistItem.findMany({
          // Samma mottagarregler som checkRestockAlerts: Pro, ej pausad, restockAlert på.
          where: {
            productId: listing.productId,
            restockAlert: true,
            isPaused: false,
            user: proUserWhere(),
          },
          select: { userId: true },
        })
      : Promise.resolve([] as { userId: string }[]),
    setId
      ? prisma.setWatch.findMany({
          where: { setId, user: proUserWhere() },
          select: { userId: true },
        })
      : Promise.resolve([] as { userId: string }[]),
  ]);

  const recipients = new Set<string>();
  for (const u of allSubs) recipients.add(u.id);
  for (const w of watchers) recipients.add(w.userId);
  for (const s of setWatchers) recipients.add(s.userId);
  if (recipients.size === 0) return { triggered: 0 };
  const subs = [...recipients].map((id) => ({ id }));

  const directWatchers = new Set(watchers.map((w) => w.userId));
  const setReasonFor = new Set(
    setWatchers.map((s) => s.userId).filter((id) => !directWatchers.has(id))
  );
  const setName = product?.set?.name ?? null;

  const fromStatus = transition?.from ?? null;
  const toStatus = transition?.to ?? null;
  const message =
    kind === "NEW_LISTING"
      ? `${listing.title} — ny produkt i lager!`
      : kind === "PREORDER"
        ? `${listing.title} — öppen för förhandsbokning!`
        : stockAlertMessage(listing.title, fromStatus, toStatus);
  // Förhandsbokning saknar egen AlertType — lagras som NEW_LISTING (det ÄR en ny
  // produkt). Mejlet väljs ändå på annonsens PREORDER-lagerstatus i buildAlertEmail.
  const type = kind === "PREORDER" ? "NEW_LISTING" : kind;
  const writes: Prisma.PrismaPromise<unknown>[] = subs.map((u) =>
    prisma.alert.create({
      data: {
        userId: u.id,
        retailerId: listing.retailerId,
        // Auto-importerad → länka VÅR produkt (in-app), annars den råa annonsen.
        productId: listing.productId ?? null,
        storeListingId: listing.productId ? null : listing.id,
        type,
        fromStatus,
        toStatus,
        reasonSetName: setReasonFor.has(u.id) ? setName : null,
        message,
        channel: "EMAIL",
      },
    })
  );
  await prisma.$transaction(writes);
  return { triggered: subs.length };
}
