import * as fs from "fs"; import * as path from "path";
for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { PrismaClient } from "@prisma/client";
import { WebhallenAdapter } from "../src/scrapers/adapters/webhallen-adapter";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.NEON_DATABASE_URL } } });
const EMAIL = "milostheking88@gmail.com";

(async () => {
  // 1) Slå på allRestocks (+ email) för användaren.
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true, notificationSettings: true } });
  if (!user) throw new Error("Användare saknas");
  const ns = { ...(user.notificationSettings as object ?? {}), allRestocks: true, email: true };
  await prisma.user.update({ where: { id: user.id }, data: { notificationSettings: ns } });
  console.log("allRestocks PÅ för", EMAIL, "→", JSON.stringify(ns));

  // 2) Hitta en Webhallen-offer som är live IN_STOCK och matchar lagrad offer → flippa till OUT så skanningen restockar den.
  const adapter = new WebhallenAdapter();
  const r = await adapter.fetchProducts();
  const liveIn = new Map<string, boolean>();
  for (const p of r.products) {
    if (!adapter.validateResult(p)) continue;
    const n = adapter.normalizeProduct(p);
    liveIn.set(n.url, n.stockStatus === "IN_STOCK");
  }
  const retailer = await prisma.retailer.findFirst({ where: { name: "Webhallen" } });
  const offers = await prisma.offer.findMany({
    where: { retailerId: retailer!.id },
    select: { id: true, url: true, productId: true, stockStatus: true, product: { select: { title: true } } },
  });
  const cand = offers.find((o) => liveIn.get(o.url) === true);
  if (!cand) { console.log("Ingen live-in-stock matchad Webhallen-offer hittad — prova Shopify."); return; }
  await prisma.offer.update({ where: { id: cand.id }, data: { stockStatus: "OUT_OF_STOCK" } });
  console.log(`Flippade till OUT: "${cand.product.title}" (offer ${cand.id}) — skanningen ska restocka den.`);
  console.log(`productId=${cand.productId}`);
})().catch(console.error).finally(() => prisma.$disconnect());
