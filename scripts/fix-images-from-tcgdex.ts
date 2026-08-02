/**
 * LAGAR DÖDA KORTBILDER VIA TCGDEX.
 *
 * pokemontcg.io (vår katalogkälla) serverar 404 för 132 kort — McDonald's-seten,
 * några promos och delar av MEP. Det är inte ett skönhetsfel: `Card.artFingerprint`
 * byggs UR bilden, så de korten har inget avtryck och är **osynliga för skannerns
 * bildmatchning**. En bildlagning är därför också en skannerlagning.
 *
 * MÄTT UTFALL 2026-08-02 (kör om innan du litar på det):
 *   TCGdex EGEN bild ...................  0 av 132   ← de har inte de här seten
 *   TCGdex → tcgplayer.productId → CDN .  48 av 132  ← mcd14/15/17/18, 12 kort styck
 *   MEP .................................  82, ingen väg alls
 *   svp/hsp .............................   2, ingen väg alls
 *
 * Vi tar alltså TCGplayers CDN i andra hand, för TCGdex har ingen egen bild för
 * något av de trasiga korten. ⚠️ LICENSLÄGET FÖR DE BILDERNA ÄR OKÄNT — ingen
 * publicerad rätt att hotlinka eller kopiera hittades. Det är ett medvetet,
 * reversibelt val: bryts hotlinken får vi tillbaka exakt dagens läge (trasig bild),
 * inte något värre. Vill man bort från det är vägen att spegla bilderna själv,
 * vilket är ett EGET beslut om lagring och rättigheter — inte en fotnot här.
 *
 * ⛔ SET-ID:N MATCHAR INTE MELLAN KÄLLORNA. Vårt `mcd17` heter `2017sm` hos TCGdex,
 * `mcd22` heter `2022swsh`. Mappningen görs därför på SETETS NAMN (168 av 176 matchar
 * automatiskt), med en explicit tabell för resten. ⛔ Gissa aldrig ett set-id från
 * mönster — "mcd17 → 2017sm" ser ut som en regel men `mcd21 → 2021swsh` bryter den.
 *
 * ⛔ SKRIVER ALDRIG EN OVERIFIERAD URL. Varje kandidatbild hämtas och måste svara
 * 200 med en bild-content-type innan den sparas. TCGdex svarar 200 på kortet men
 * saknar ibland `image` helt (mätt: svp-102), och en trasig URL som ersätter en
 * annan trasig URL är ingen förbättring — den döljer bara felet.
 *
 *   npx tsx scripts/fix-images-from-tcgdex.ts            # torrkörning
 *   APPLY=1 npx tsx scripts/fix-images-from-tcgdex.ts    # skriver
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

/** Set där namnmatchningen inte räcker. Vår externalId → TCGdex set-id. */
const SET_OVERRIDES: Record<string, string> = {
  base1: "base1",
  hgss2: "hgss2",
  hgss3: "hgss3",
  hgss4: "hgss4",
  svp: "svp",
  sve: "sve",
  fut20: "fut20",
};

/** TCGdex serverar bilden utan ändelse; kvalitet + format läggs på av oss. */
const IMAGE_SUFFIXES = ["/high.webp", "/high.png", "/low.webp", "/low.png"] as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function imageWorks(url: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    if (!r.ok) return false;
    // Content-type MÅSTE vara en bild: TCGdex svarar 200 med en HTML-felsida på
    // vissa saknade varianter, och den hade sparats som "fungerande" annars.
    return (r.headers.get("content-type") ?? "").startsWith("image/");
  } catch {
    return false;
  }
}

async function main() {
  const broken = await prisma.card.findMany({
    where: { artFingerprint: null },
    select: {
      id: true,
      name: true,
      number: true,
      imageUrl: true,
      set: { select: { name: true, externalId: true } },
    },
    orderBy: { id: "asc" },
  });
  console.log(`Kort utan avtryck (= kandidater med trasig bild): ${broken.length}`);

  const dexSets = (await (await fetch("https://api.tcgdex.net/v2/en/sets")).json()) as {
    id: string;
    name: string;
  }[];
  const dexByName = new Map(dexSets.map((s) => [norm(s.name), s.id]));

  let fixed = 0;
  let noCard = 0;
  let noImage = 0;
  const unmappedSets = new Set<string>();

  for (const c of broken) {
    const ext = c.set.externalId ?? "";
    const dexSet = SET_OVERRIDES[ext] ?? dexByName.get(norm(c.set.name));
    if (!dexSet) {
      unmappedSets.add(`${c.set.name} (${ext})`);
      continue;
    }
    const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${dexSet}-${c.number}`);
    if (!res.ok) {
      noCard++;
      continue;
    }
    const card = (await res.json()) as {
      image?: string;
      pricing?: { tcgplayer?: Record<string, { productId?: number } | undefined> };
    };

    // Kandidater i FALLANDE önskvärdhet: TCGdex egen CDN (MIT-databas, uttalat
    // cachningsvänlig) före TCGplayers (okänt licensläge). Att bygga listan i
    // ordning och ta första som BEVISAR sig gör preferensen till kod, inte till
    // en kommentar någon kan råka bryta.
    const candidates: string[] = [];
    if (card.image) for (const s of IMAGE_SUFFIXES) candidates.push(`${card.image}${s}`);
    const pid = Object.values(card.pricing?.tcgplayer ?? {}).find((v) => v?.productId)?.productId;
    if (pid) candidates.push(`https://tcgplayer-cdn.tcgplayer.com/product/${pid}_in_1000x1000.jpg`);

    let url: string | null = null;
    for (const candidate of candidates) {
      if (await imageWorks(candidate)) {
        url = candidate;
        break;
      }
    }
    if (!url) {
      noImage++;
      continue;
    }
    console.log(`  ${c.set.name} #${c.number} ${c.name}\n      → ${url}`);
    if (APPLY) await prisma.card.update({ where: { id: c.id }, data: { imageUrl: url } });
    fixed++;
  }

  console.log(
    `\n${APPLY ? "SKREV" : "TORRKÖRNING"}: ${fixed} lagade · ${noCard} saknas hos TCGdex · ${noImage} utan användbar bild`
  );
  if (unmappedSets.size) console.log(`Omappade set: ${[...unmappedSets].join(" · ")}`);
  if (fixed && APPLY) {
    console.log(
      "\n⛔ NÄSTA STEG: kör scripts/build-art-fingerprints.ts — bilderna är lagade men\n" +
        "   avtrycken byggs inte av sig själva, och det är avtrycket som gör korten\n" +
        "   synliga för skannerns bildmatchning."
    );
  }
  await prisma.$disconnect();
}

main();
