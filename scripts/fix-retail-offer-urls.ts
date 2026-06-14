import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const SEARCH_URL: Record<string, (q: string) => string> = {
  "Webhallen": q => "https://www.webhallen.com/se/search?searchString=" + encodeURIComponent(q),
  "Alphaspel": q => "https://alphaspel.se/search/?query=" + encodeURIComponent(q),
  "Spelexperten": q => "https://www.spelexperten.com/cgi-bin/ibutik/AIR_ibutik.fcgi?funk=sok&sokstr=" + encodeURIComponent(q),
  "Dragon's Lair": q => "https://www.dragonslair.se/search?q=" + encodeURIComponent(q),
  "Spelbutiken": q => "https://www.spelbutiken.se/sok?s=" + encodeURIComponent(q),
  "CDON": q => "https://cdon.se/search?q=" + encodeURIComponent(q),
};

async function main() {
  // Retail offers whose URL has no product-specific path (homepage/category)
  const offers = await prisma.offer.findMany({
    where: {
      retailer: { name: { notIn: ["Cardmarket", "Tradera"] } },
    },
    select: {
      id: true, url: true,
      retailer: { select: { name: true } },
      product: { select: { title: true } },
    },
  });
  console.log("Retail offers: " + offers.length);

  const isGeneric = (u: string | null) => {
    if (!u) return true;
    try {
      const { pathname, search } = new URL(u);
      // generic = homepage, top category, or no query string with short path
      const segs = pathname.split("/").filter(Boolean);
      if (search.length > 0) return false;
      return segs.length <= 2;
    } catch { return true; }
  };

  let updated = 0, skippedSpecific = 0, noTemplate = 0;
  for (const o of offers) {
    if (!isGeneric(o.url)) { skippedSpecific++; continue; }
    const make = SEARCH_URL[o.retailer.name];
    if (!make) { noTemplate++; console.log("  no template: " + o.retailer.name + " " + o.url); continue; }
    const q = ("Pokemon " + o.product.title).replace(/·/g, " ").replace(/\s+/g, " ").trim();
    await prisma.offer.update({ where: { id: o.id }, data: { url: make(q) } });
    updated++;
  }
  console.log("Updated: " + updated + ", already specific: " + skippedSpecific + ", no template: " + noTemplate);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
