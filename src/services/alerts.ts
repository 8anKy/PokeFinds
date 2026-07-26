/** Alerttjänster: skapande, listning, läsmarkering samt pris-/restock-kontroller. */
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { isBlockedListingLanguage } from "@/lib/listing-language";
import { proUserWhere } from "@/lib/plan";
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
 * FLAPP-DÄMPNING (2026-07-26). En butik som pytsar ut en het vara växlar
 * "i lager"/"slut" om vartannat: Dragon's Lair togglade Pitch Black ETB och
 * Booster Box 28 respektive 45 gånger på tre dygn (uppmätt i feeden — både
 * kollektions-JSON och produktens egen `.js` sa samma sak, så det är butikens
 * riktiga lager som studsar, inte vår sampling). Enda skyddet var 2h-cooldownen
 * → ett mejl varannan timme, dygnet runt, för samma produkt.
 *
 * Två regler, båda mätta mot HELA restock-historiken (21 dgr, 470 händelser)
 * innan de skeppades — inte gissade:
 *
 *   A. BLINK: är produkten tillbaka i det tillstånd den nyss lämnade, inom
 *      `minAwayMinutes`, har den aldrig varit borta på riktigt. Inget larm.
 *   B. FLAPP: har paret (produkt, butik) fler än `flapMaxTransitions`
 *      lagerövergångar det senaste dygnet är butiken i droppläge → cooldownen
 *      förlängs till `flapCooldownHours` (ett besked per dygn i stället för
 *      ett varannan timme). Tystar INTE helt: att en het vara trillar in med
 *      jämna mellanrum är i sig information värd ett larm om dagen.
 *
 * Utfall på facit: 177 → 147 larmtillfällen totalt, och de värsta paren faller
 * från 12/6 till 7/3. Två par tappar sitt enda larm helt — båda var 30-minuters
 * blinkar (produkten lämnade aldrig hyllan). Ingen produkt med en ÄKTA
 * påfyllning (borta > 1 h) blir tyst.
 */
export const FLAP_WINDOW_HOURS = 24;

export interface FlapPolicy {
  minAwayMinutes: number;
  flapMaxTransitions: number;
  flapCooldownHours: number;
}

export function flapPolicy(): FlapPolicy {
  return {
    minAwayMinutes: Number(process.env.RESTOCK_MIN_AWAY_MINUTES ?? 60),
    flapMaxTransitions: Number(process.env.RESTOCK_FLAP_MAX_TRANSITIONS ?? 6),
    flapCooldownHours: Number(process.env.RESTOCK_FLAP_COOLDOWN_HOURS ?? 24),
  };
}

/**
 * Ren dom över `recent` = lagerövergångarna (RestockEvent) för EN produkt hos EN
 * butik, nyast först. Filtrerar själv till dygnsfönstret så den inte är beroende
 * av att anroparens fråga råkar ha rätt `gte`.
 *
 * Övergången som just larmar ingår i `recent` (runner skriver händelsen FÖRE
 * larmet, med flit — se ordningskommentaren i runRestockScan). Den kan aldrig
 * matcha blink-regeln själv: dess `oldStatus` är det tillstånd vi lämnade, inte
 * det vi återvänder till.
 */
export function evaluateStockFlap(
  recent: { oldStatus: StockStatus; detectedAt: Date }[],
  toStatus: StockStatus | null,
  now: Date,
  policy: FlapPolicy
): { blip: boolean; cooldownHours: number } {
  const windowStart = now.getTime() - FLAP_WINDOW_HOURS * 3600_000;
  const inWindow = recent.filter((e) => e.detectedAt.getTime() >= windowStart);

  // A: senaste gången produkten LÄMNADE tillståndet den nu återvänder till.
  const left = toStatus == null ? undefined : inWindow.find((e) => e.oldStatus === toStatus);
  const blip =
    policy.minAwayMinutes > 0 &&
    left != null &&
    now.getTime() - left.detectedAt.getTime() < policy.minAwayMinutes * 60_000;

  const flapping =
    policy.flapMaxTransitions > 0 && inWindow.length > policy.flapMaxTransitions;
  return { blip, cooldownHours: flapping ? policy.flapCooldownHours : 0 };
}

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

/**
 * Kontrollerar prislarm för en produkt vid nytt pris (öre).
 * Skapar Alert (EMAIL) för bevakningar med targetPrice >= newPrice.
 */
export async function checkPriceAlerts(productId: string, newPrice: number) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, title: true, slug: true },
  });
  if (!product) return { triggered: 0 };

  const watchers = await prisma.watchlistItem.findMany({
    where: {
      productId,
      priceAlert: true,
      isPaused: false,
      targetPrice: { not: null, gte: newPrice },
      // Prislarm är en Pro-förmån (jfr restock-larm). Admins räknas som Pro — se isPro().
      user: proUserWhere(),
    },
    select: { userId: true, targetPrice: true },
  });
  if (watchers.length === 0) return { triggered: 0 };

  const message = `${product.title} har nått ditt målpris! Nuvarande pris: ${formatSek(newPrice)}.`;
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const w of watchers) {
    writes.push(
      prisma.alert.create({
        data: {
          userId: w.userId,
          productId,
          type: "PRICE_TARGET",
          message,
          channel: "EMAIL",
        },
      })
    );
  }
  await prisma.$transaction(writes);
  return { triggered: watchers.length };
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
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, title: true, slug: true },
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

  const [watchers, allSubs] = await Promise.all([
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
  ]);

  const userIds = new Set<string>();
  for (const w of watchers) userIds.add(w.userId);
  for (const u of allSubs) userIds.add(u.id);
  if (userIds.size === 0) return { triggered: 0 };

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
  // Blockade språk (kinesiska/koreanska) larmar vi inte på "for now". Japanska = OK.
  if (isBlockedListingLanguage(listing.title)) return { triggered: 0 };

  const [allSubs, watchers] = await Promise.all([
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
  ]);

  const recipients = new Set<string>();
  for (const u of allSubs) recipients.add(u.id);
  for (const w of watchers) recipients.add(w.userId);
  if (recipients.size === 0) return { triggered: 0 };
  const subs = [...recipients].map((id) => ({ id }));

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
        message,
        channel: "EMAIL",
      },
    })
  );
  await prisma.$transaction(writes);
  return { triggered: subs.length };
}
