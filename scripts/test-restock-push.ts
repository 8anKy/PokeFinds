/**
 * Skicka ETT riktigt restock-larm (push + mejl) till ett konto för en vald butik, så
 * att larmvägen kan provas på telefonen — samma Alert-rad och samma dispatch som
 * lanen skapar, inget fejkat i klienten.
 *
 *   railway run npx tsx scripts/test-restock-push.ts --user <e-post> --retailer "MaxGaming" --apply
 *
 * `railway run` = APNs-nycklar + prod-DB ur tjänstens variabler. Väljer butikens
 * första köpbara offer MED korglänk (så pushen får /cart/add- eller brygg-länken).
 * Utan --apply bara rapport. Skrevs 2026-09-18 för korglänksprovet.
 */
import { StockStatus } from "@prisma/client";
import { prisma, ensureDbAwake } from "../src/lib/db";
import { stockAlertMessage } from "../src/services/alerts";
import { dispatchPendingAlerts } from "../src/services/notifications";
import { exitJob } from "../src/lib/job-exit";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("user");
  const retailerName = arg("retailer");
  const apply = process.argv.includes("--apply");
  if (!email || !retailerName) throw new Error("Ange --user <e-post> och --retailer <namn>.");
  await ensureDbAwake();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true } });
  if (!user) throw new Error(`Ingen användare ${email}`);
  const retailer = await prisma.retailer.findUnique({ where: { name: retailerName }, select: { id: true, name: true } });
  if (!retailer) throw new Error(`Ingen butik ${retailerName}`);
  const offer = await prisma.offer.findFirst({
    where: {
      retailerId: retailer.id,
      cartUrl: { not: null },
      stockStatus: { in: [StockStatus.IN_STOCK, StockStatus.PREORDER] },
      product: { hiddenAt: null },
    },
    orderBy: { lastSeenAt: "desc" },
    select: { url: true, cartUrl: true, stockStatus: true, product: { select: { id: true, title: true, slug: true } } },
  });
  if (!offer) throw new Error(`${retailer.name}: ingen köpbar offer med korglänk`);
  const tokens = await prisma.pushToken.count({ where: { userId: user.id } });
  console.log(`Till ${user.email} (${user.role}, ${tokens} push-token): ${offer.product.title}`);
  console.log(`  butik ${offer.url}\n  korg  ${offer.cartUrl}`);
  if (!apply) return console.log("Torrkörning — lägg till --apply för att skicka.");
  await prisma.alert.create({
    data: {
      userId: user.id,
      productId: offer.product.id,
      retailerId: retailer.id,
      type: "RESTOCK",
      fromStatus: StockStatus.OUT_OF_STOCK,
      toStatus: StockStatus.IN_STOCK,
      message: `[TEST] ${stockAlertMessage(offer.product.title, StockStatus.OUT_OF_STOCK, StockStatus.IN_STOCK)}`,
      channel: "EMAIL",
    },
  });
  const r = await dispatchPendingAlerts();
  console.log(`dispatch: skickade ${r.sent}, misslyckade ${r.failed}`);
}

main()
  .then(() => exitJob(0))
  .catch(async (e) => {
    console.error(e);
    await exitJob(1);
  });
