/**
 * TESTSET FÖR EN SKANNER UTAN AI — riktiga säljarfoton från Tradera med känt facit.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/scanner-tradera-facit.ts          (N=2000)
 *   N=500 node scripts/with-prod-db.mjs npx tsx scripts/scanner-tradera-facit.ts
 *
 * VARFÖR: en bildmatchare måste mätas mot RIKTIGA foton (mobil, hylsa, toploader, bord, dåligt
 * ljus) — syntetiskt försämrade referensbilder gav 96–98 % i juli som inte höll i fält. Vi har redan
 * ~100 000 säljarfoton av ~17 500 olika singlar, varje annons kopplad till ett kort i katalogen.
 *
 * FACIT = annonsens produkt → kort, men bara när TITELN bär kortets nummer (kopplingen är
 * automatisk och ibland fel; numret i titeln är säljarens eget belägg). Bort: graderade
 * (isGradedListing — en slabb är en annan bild), lotter/flera kort, proxies/jumbo.
 * ⛔ Kvarvarande brus (baksida, fel huvudbild) är okänt — stickprova visuellt innan ett tal citeras.
 *
 * URVAL: högst EN annons per produkt och ett tak per set, så inget set (30th Celebration!)
 * dominerar — ägarens första 101 var 85 % ett set.
 * ⛔ Bara intern mätning: bilderna publiceras aldrig och ligger bara i `.spike/` (gitignorerad).
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { isGradedListing } from "../src/lib/graded-listing";

const prisma = new PrismaClient();
const N = Number(process.env.N ?? "2000");
const OUT = path.join(process.cwd(), ".spike", "tradera-facit");

/** Lotter, flera kort, repliker — titeln säger att bilden inte är ETT äkta kort. */
const NOT_ONE_CARD =
  /\b(lot|lott|lotter|paket|bundle|samling|blandad|blandat|mixed|bulk|proxy|fake|custom|jumbo|oversized|orica|kopia)\b|\b\d+\s?(st|stycken|kort|cards)\b|\bx\s?\d+\b|\+/i;

/** Kortets nummer som ett eget token i titeln ("148/144", "#148", "TG05", "SWSH186", "MEP 101"). */
export function titleHasNumber(title: string, number: string): boolean {
  const n = number.trim();
  const m = /^([A-Za-z]*)\s*0*(\d+)([A-Za-z]?)$/.exec(n);
  if (!m) return title.toLowerCase().includes(n.toLowerCase());
  const [, prefix, digits, suffix] = m;
  const re = new RegExp(
    `(?<![0-9A-Za-z])${prefix ? `${prefix}\\s?` : ""}0*${digits}${suffix}(?![0-9])`,
    "i"
  );
  return re.test(title);
}

interface Row {
  itemId: string;
  title: string;
  imageUrl: string;
  cardId: string;
  name: string;
  number: string;
  language: string;
  setId: string;
  setName: string;
  released: Date | null;
  refImage: string | null;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT DISTINCT ON (p.id)
      t."itemId", t.title, t."imageUrl", c.id AS "cardId", c.name, c.number, c.language::text AS language,
      s.id AS "setId", s.name AS "setName", s."releaseDate" AS released, c."imageUrl" AS "refImage"
    FROM "TraderaListing" t
    JOIN "Product" p ON p.id = t."productId"
    JOIN "Card" c ON c.id = p."cardId"
    JOIN "CardSet" s ON s.id = c."setId"
    WHERE t."imageUrl" IS NOT NULL AND p.category = 'SINGLE_CARD'
    ORDER BY p.id, t."lastSeenAt" DESC`;

  const ok = rows.filter(
    (r) =>
      !NOT_ONE_CARD.test(r.title) &&
      !isGradedListing({ title: r.title }) &&
      titleHasNumber(r.title, r.number)
  );
  console.log(`Annonser (en per produkt): ${rows.length} · titeln bär numret, ej lot/graderad: ${ok.length}`);

  // Tak per set: rättvist urval över set, fyll sedan upp.
  const bySet = new Map<string, Row[]>();
  for (const r of ok) (bySet.get(r.setId) ?? bySet.set(r.setId, []).get(r.setId)!).push(r);
  for (const list of bySet.values()) list.sort(() => Math.random() - 0.5);
  const picked: Row[] = [];
  for (let round = 0; picked.length < N; round++) {
    let any = false;
    for (const list of bySet.values()) {
      if (list[round]) {
        picked.push(list[round]);
        any = true;
        if (picked.length >= N) break;
      }
    }
    if (!any) break;
  }

  const labels = [];
  let fetched = 0;
  for (const r of picked) {
    const file = `${r.itemId}.jpg`;
    const dest = path.join(OUT, file);
    if (!fs.existsSync(dest)) {
      const url = r.imageUrl.replace("/medium-fit/", "/large-fit/");
      const res = await fetch(url, { headers: { "user-agent": "Foilio/1.0 (+https://foilio.se)" } });
      if (!res.ok) continue;
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      fetched++;
      await new Promise((ok) => setTimeout(ok, 120)); // artigt mot Traderas bild-CDN
    }
    labels.push({
      itemId: r.itemId,
      file,
      title: r.title,
      truthCardId: r.cardId,
      name: r.name,
      number: r.number,
      language: r.language,
      set: r.setName,
      year: r.released ? new Date(r.released).getUTCFullYear() : null,
      refImage: r.refImage,
    });
  }
  fs.writeFileSync(path.join(OUT, "labels.json"), JSON.stringify(labels, null, 1));
  const langs = labels.reduce<Record<string, number>>((a, l) => ((a[l.language] = (a[l.language] ?? 0) + 1), a), {});
  console.log(`Testset: ${labels.length} foton (nya ${fetched}) ur ${new Set(labels.map((l) => l.set)).size} set · språk ${JSON.stringify(langs)} → ${OUT}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
