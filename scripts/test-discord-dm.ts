/**
 * Skicka ETT test-larm som Discord-DM till ett konto (Pro-funktionen "larm som DM"),
 * byggt ur en riktig butiksoffer — samma embed som utskicket. Rör inga Alert-rader,
 * inget mejl, ingen push.
 *
 *   railway run npx tsx scripts/test-discord-dm.ts --user <e-post|discord-namn>   (rapport)
 *   railway run npx tsx scripts/test-discord-dm.ts --user <e-post> --apply   (skickar)
 *
 * `railway run` = bot-token + prod-DB ur tjänstens variabler (aldrig i kommandoraden).
 */
import { StockStatus } from "@prisma/client";
import { prisma, ensureDbAwake } from "../src/lib/db";
import { sendAlertDm } from "../src/lib/discord-dm";
import { parseNotificationSettings } from "../src/lib/notification-settings";
import { isPro, PRO_USER_SELECT } from "../src/lib/plan";
import { formatPrice } from "../src/lib/format";
import { buyLink } from "../src/lib/cart-url";
import { exitJob } from "../src/lib/job-exit";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se").replace(/\/$/, "");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("user");
  if (!email) throw new Error("Ange --user <e-post>.");
  await ensureDbAwake();
  // E-post ELLER kopplat Discord-namn (ägarens Discord sitter ofta på ett annat konto).
  const user = await prisma.user.findFirst({
    where: { OR: [{ email }, { discordUsername: { equals: email, mode: "insensitive" } }] },
    select: { id: true, discordUserId: true, discordUsername: true, notificationSettings: true, ...PRO_USER_SELECT },
  });
  if (!user) throw new Error(`Ingen användare ${email}`);
  const settings = parseNotificationSettings(user.notificationSettings);
  console.log(
    `Discord: ${user.discordUsername ?? "(inte kopplat)"} · Pro: ${isPro(user)} · DM-reglaget: ${settings.discord ? "PÅ" : "av"}`
  );
  if (!user.discordUserId) throw new Error("Kontot har inget kopplat Discord-konto.");

  const offer = await prisma.offer.findFirst({
    where: { stockStatus: StockStatus.IN_STOCK, cartUrl: { not: null }, price: { gt: 0 }, product: { hiddenAt: null } },
    orderBy: { lastSeenAt: "desc" },
    select: {
      url: true,
      cartUrl: true,
      price: true,
      retailer: { select: { name: true } },
      product: { select: { title: true, slug: true, imageUrl: true } },
    },
  });
  if (!offer) throw new Error("Hittade ingen köpbar offer att bygga testet av.");

  const content = {
    title: "Åter i lager! (test)",
    body: `${offer.product.title} finns i lager hos ${offer.retailer.name} för ${formatPrice(offer.price)}. Det här är ett testmeddelande från Foilio.`,
    url: settings.pushTarget === "foilio" ? `${APP_URL}/produkter/${offer.product.slug}` : buyLink(offer.cartUrl, offer.url),
    imageUrl: offer.product.imageUrl?.startsWith("/") ? `${APP_URL}${offer.product.imageUrl}` : offer.product.imageUrl,
  };
  console.log(`Test: ${content.body}\nLänk: ${content.url}`);
  if (!process.argv.includes("--apply")) {
    console.log("Torrkörning — lägg till --apply för att skicka.");
    return;
  }
  const result = await sendAlertDm(user.discordUserId, content);
  console.log(`Resultat: ${result}`);
  if (result === "closed") console.log("DM stängda: slå på 'Direktmeddelanden från servermedlemmar' för servern i Discord.");
  if (result !== "sent") process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => exitJob());
