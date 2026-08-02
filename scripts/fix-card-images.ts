/**
 * LAGAR DÖDA KORTBILDER.
 *
 * pokemontcg.io (vår katalogkälla) serverar 404 för 132 kort — McDonald's-seten,
 * MEP Black Star Promos och ett par promos. Det är inte ett skönhetsfel:
 * `Card.artFingerprint` byggs UR bilden, så de korten har inget avtryck och är
 * **osynliga för skannerns bildmatchning**. En bildlagning är en skannerlagning.
 *
 * TRE KÄLLOR, I FALLANDE ÖNSKVÄRDHET — ordningen ÄR beslutet:
 *  1. **TCGGO** (`images.tcggo.com`) — vår BEFINTLIGA, betalda prisleverantör.
 *     Att använda bilder från någon vi redan har ett kommersiellt förhållande
 *     till är rimligare än att hotlinka en främmande CDN. De har dessutom flest:
 *     MEP-seten finns BARA här (mätt 2026-08-02).
 *  2. **TCGdex** (MIT, uppmuntrar cachning) — men de hade EGEN bild för 0 av
 *     våra 132 trasiga kort. Behålls som väg för framtida luckor.
 *  3. **TCGplayers CDN** via TCGdex `tcgplayer.productId` — sista utväg,
 *     ⚠️ LICENSLÄGET ÄR OKÄNT. Reversibelt: bryts hotlinken får vi tillbaka
 *     exakt dagens läge (trasig bild), inte något värre.
 *
 * ⛔ MATCHNINGEN MÅSTE KLARA KORT UTAN `tcgExternalId`. MEP-korten kom in via
 * Cardmarket-importen, inte från pokemontcg.io, så de har inget tcgid alls —
 * och det är de 82 korten som är den största luckan. För dem matchas TCGGO:s
 * träffar på KORTNUMMER **och** NAMN, med numret normaliserat (deras "MEP 023"
 * mot vårt "023"). Båda måste stämma: ett nummer ensamt räcker inte i ett
 * promo-set där numreringen återanvänds mellan serier.
 *
 * ⛔ SKRIVER ALDRIG EN OVERIFIERAD URL. Varje kandidat hämtas och måste svara
 * 200 med bild-content-type. TCGdex svarar 200 på kortet men saknar ibland
 * `image` helt, och en trasig URL som ersätter en annan döljer bara felet.
 *
 *   npx tsx scripts/fix-card-images.ts            # torrkörning
 *   APPLY=1 npx tsx scripts/fix-card-images.ts    # skriver
 *
 * Nyckeln läses ur .env I PROCESSEN (aldrig via kommandorad eller logg) när den
 * inte redan finns i miljön — samma skäl som scripts/with-prod-db.mjs dokumenterar.
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

function fromDotEnv(key: string): string | undefined {
  try {
    const raw = fs.readFileSync(".env", "utf8");
    return new RegExp(`^${key}\\s*=\\s*["']?([^"'\\r\\n]+)`, "m").exec(raw)?.[1];
  } catch {
    return undefined;
  }
}

const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? fromDotEnv("CARDMARKET_RAPIDAPI_KEY");
const HOST =
  process.env.CARDMARKET_RAPIDAPI_HOST ??
  fromDotEnv("CARDMARKET_RAPIDAPI_HOST") ??
  "cardmarket-api-tcg.p.rapidapi.com";
if (!process.env.DATABASE_URL) {
  const url = fromDotEnv("NEON_DATABASE_URL");
  if (url) process.env.DATABASE_URL = url;
}

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

/** TCGdex-set där namnmatchningen inte räcker. Vår externalId → deras set-id. */
const SET_OVERRIDES: Record<string, string> = {
  base1: "base1",
  hgss2: "hgss2",
  hgss3: "hgss3",
  hgss4: "hgss4",
  svp: "svp",
  sve: "sve",
  fut20: "fut20",
};

const IMAGE_SUFFIXES = ["/high.webp", "/high.png", "/low.webp", "/low.png"] as const;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "MEP 023" → "23" · "023/93" → "23" · "HGSS18" → "hgss18". */
function numKey(s: string): string {
  const t = s.toLowerCase().replace(/\s+/g, "").split("/")[0];
  const stripped = t.replace(/^0+/, "");
  return /^\d+$/.test(stripped || "0") ? String(Number(t || "0")) : stripped;
}

async function imageWorks(url: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    if (!r.ok) return false;
    return (r.headers.get("content-type") ?? "").startsWith("image/");
  } catch {
    return false;
  }
}

interface TcggoCard {
  name?: string;
  image?: string;
  image_url?: string;
  card_number?: string;
  number?: string;
}

async function tcggo(path: string): Promise<TcggoCard[]> {
  if (!KEY) return [];
  try {
    const r = await fetch(`https://${HOST}${path}`, {
      headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY },
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: TcggoCard[]; cards?: TcggoCard[] };
    return j.data ?? j.cards ?? [];
  } catch {
    return [];
  }
}

async function main() {
  if (!KEY) console.warn("⚠️ Ingen RapidAPI-nyckel — TCGGO-vägen hoppas över.");

  // Mål: kort utan avtryck (trasig bild) OCH kort vi tidigare pekade mot
  // TCGplayers CDN, så de kan flyttas till en bättre källa om en finns.
  const targets = await prisma.card.findMany({
    where: { OR: [{ artFingerprint: null }, { imageUrl: { contains: "tcgplayer-cdn" } }] },
    select: {
      id: true,
      name: true,
      number: true,
      imageUrl: true,
      tcgExternalId: true,
      set: { select: { name: true, externalId: true } },
    },
    orderBy: { id: "asc" },
  });
  console.log(`Kandidater: ${targets.length}`);

  const dexSets = (await (await fetch("https://api.tcgdex.net/v2/en/sets")).json()) as {
    id: string;
    name: string;
  }[];
  const dexByName = new Map(dexSets.map((s) => [norm(s.name), s.id]));

  /** TCGGO-träffar per set, cachade — MEP har 82 kort och ska inte kosta 82 sökningar. */
  const tcggoBySet = new Map<string, TcggoCard[]>();

  let fixed = 0;
  let unresolved = 0;
  const bySource = new Map<string, number>();

  for (const c of targets) {
    const candidates: string[] = [];

    // --- Källa 1: TCGGO ---
    if (c.tcgExternalId) {
      const hit = (await tcggo(`/pokemon/cards?tcgid=${encodeURIComponent(c.tcgExternalId)}`))[0];
      const img = hit?.image ?? hit?.image_url;
      if (img) candidates.push(img);
    } else {
      const setKey = c.set.externalId ?? c.set.name;
      let rows = tcggoBySet.get(setKey);
      if (!rows) {
        rows = await tcggo(`/pokemon/cards?search=${encodeURIComponent(c.set.name)}&limit=250`);
        tcggoBySet.set(setKey, rows);
      }
      const want = numKey(c.number);
      const hit = rows.find((r) => {
        const n = r.card_number ?? r.number;
        return n != null && numKey(String(n)) === want && norm(r.name ?? "") === norm(c.name);
      });
      const img = hit?.image ?? hit?.image_url;
      if (img) candidates.push(img);
    }

    // --- Källa 2 + 3 ---
    const dexSet = SET_OVERRIDES[c.set.externalId ?? ""] ?? dexByName.get(norm(c.set.name));
    if (dexSet) {
      const r = await fetch(`https://api.tcgdex.net/v2/en/cards/${dexSet}-${c.number}`);
      if (r.ok) {
        const card = (await r.json()) as {
          image?: string;
          pricing?: { tcgplayer?: Record<string, { productId?: number } | undefined> };
        };
        if (card.image) for (const s of IMAGE_SUFFIXES) candidates.push(`${card.image}${s}`);
        const pid = Object.values(card.pricing?.tcgplayer ?? {}).find((v) => v?.productId)
          ?.productId;
        if (pid)
          candidates.push(`https://tcgplayer-cdn.tcgplayer.com/product/${pid}_in_1000x1000.jpg`);
      }
    }

    let url: string | null = null;
    for (const candidate of candidates) {
      if (await imageWorks(candidate)) {
        url = candidate;
        break;
      }
    }
    if (!url) {
      unresolved++;
      continue;
    }
    if (url === c.imageUrl) continue;

    const src = url.includes("tcggo") ? "TCGGO" : url.includes("tcgdex") ? "TCGdex" : "TCGplayer";
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
    console.log(`  [${src}] ${c.set.externalId} #${c.number} ${c.name}`);
    if (APPLY) await prisma.card.update({ where: { id: c.id }, data: { imageUrl: url } });
    fixed++;
  }

  console.log(
    `\n${APPLY ? "SKREV" : "TORRKÖRNING"}: ${fixed} lagade · ${unresolved} utan någon fungerande källa`
  );
  console.log(`  per källa: ${[...bySource].map(([k, n]) => `${k}=${n}`).join(" · ") || "(inga)"}`);
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
