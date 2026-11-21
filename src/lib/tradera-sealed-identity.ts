/**
 * FÖRSEGLAT PÅ TRADERA: PRODUKTENS SÄRDRAG MÅSTE STÅ I ANNONSEN (2026-11-21, ägarbeslut: regler, inte en
 * modell). Ur två handgranskade stickprov av LEVANDE offers (11-13: 170 sealed, 11-21: 150 sealed,
 * `.spike/tradera-eval/live-sample-*.json`) — varje fel var en motsägelse mellan katalogtiteln och
 * annonstiteln, aldrig en bedömningsfråga:
 *  - "Fun Pack (3 Cards)" fick boosterpaket och blistrar; "3-Pack Blister" fick lösa paket.
 *  - mini-tins ur FEL serie ("Kanto Friends Pikachu" på Kanto Power och Paldea Friends, "30th
 *    Celebration Pikachu" på Pokémon GO-tinen), flera tins i en annons, US-tin på EU-produkten.
 *  - "ex box" på en Premium Collection; Ultra-/Super-Premium utan sitt ord.
 *  - en ANNAN Build & Battle/Stadium (Evolving Skies på grund-SWSH, Silver Tempest på Lost Origin).
 *  - boxens kvalificerare saknas: 18 boosters, half, Enhanced, Pokémon Center, tom ETB-ask.
 * Ren och testad (tests/unit/tradera-sealed-identity.test.ts); mätt mot båda stickproven + facit-725 med
 * scripts/_tradera-rules-eval.ts (oincheckad) innan den kopplades in. Ett skäl = fäll; null = ingen invändning.
 */

function norm(s: string): string {
  return ` ${s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}
const has = (t: string, w: string) => t.includes(` ${w} `);

/** Eror som även är setnamn ("Sword & Shield", "Mega Evolution") — en annons nämner dem som prefix. */
const ERA_SETS = ["sword shield", "scarlet violet", "sun moon", "black white", "mega evolution", "xy", "diamond pearl"];

/** Setnamnen (normaliserade) som står i texten, längsta först, utan de som ryms i ett längre träffat namn. */
function setsIn(t: string, sets: readonly string[]): string[] {
  const hits = sets.filter((s) => s.length >= 5 && t.includes(` ${s} `)).sort((a, b) => b.length - a.length);
  return hits.filter((s, i) => !hits.slice(0, i).some((l) => l.includes(s)));
}

const FORM_WORDS = new Set(["mini", "tins", "tin", "pokemon", "the", "of", "and", "collection", "box"]);

export function sealedIdentityProblem(
  catalogTitle: string,
  catalogCategory: string,
  listingTitle: string,
  setNames: readonly string[] = []
): string | null {
  if (catalogCategory === "SINGLE_CARD" || catalogCategory === "GRADED_CARD") return null;
  const c = norm(catalogTitle);
  const l = norm(listingTitle);

  // KORTNUMMER I ANNONSEN = lösa kort, inte varan ("30th Celebrations Greninja EX 021 & Fuecoco EX 015"
  // låg på Greninja ex-tinen och -boxen). "X/Y" eller ett mekaniksuffix följt av ett tresiffrigt nummer.
  if (/(?<!\d)\d{1,3}\s?\/\s?\d{2,3}(?!\d)/.test(listingTitle) || /\b(?:ex|gx|v|vmax|vstar)\s0\d\d\b/.test(l)) {
    return "kortnummer i annonsen (lösa kort)";
  }

  // FUN PACK ↔ allt annat. "Fun Pack (3 Cards)" är en egen vara; en annons för boosterpaket eller
  // blister är inte den, och en fun pack-annons är inte ett boosterpaket.
  const lFun = /\bfun ?packs?\b|\bsampling ?packs?\b/.test(l);
  const cFun = /\bfun pack\b|\bsampling pack\b/.test(c);
  if (cFun && !lFun) return "Fun Pack saknas i annonsen";
  if (lFun && !cFun) return "Fun Pack ≠ katalogens produkt";

  // BLISTER ↔ inte blister ("3-pack blister" på en fun pack/ett paket, eller tvärtom).
  const lBlister = /\bblisters?\b|\b[23] ?pack\b|\bcheck ?lane\b/.test(l);
  const cBlister = /\bblister\b|\bcheck ?lane\b|\b[23] pack\b/.test(c);
  if (cBlister && !lBlister && /BLISTER/.test(catalogCategory)) return "blister saknas i annonsen";
  if (lBlister && !cBlister && /BOOSTER_PACK|COLLECTION_BOX|TIN/.test(catalogCategory)) return "blister ≠ katalogens produkt";

  // TINS: "Serie Mini Tins: Karaktär Tin" — seriens ord måste stå i annonsen och minst en karaktär.
  if (catalogCategory === "TIN" || /\btins?\b/.test(c)) {
    if (/\b(?:[2-9]|1\d)\s?(?:x\s?)?(?:mini ?)?tins\b|\btins set\b/.test(l)) return "flera tins";
    // En tin-annons säger tin/burk/plåt/dåse — "Clip 'N' Go - Minccino & Poké Ball" är en annan vara.
    if (catalogCategory === "TIN" && !/\b(?:mini ?)?tins?\b|burk|plat|dase|\bdose\b/.test(l)) return "tin saknas i annonsen";
    // Karaktären (minst en) krävs alltid. Serien krävs när karaktären INTE är unik: mini-tins (Pikachu
    // finns i Kanto Power, Kanto Friends, Paldea Friends, Pokémon GO och 30th Celebration) och tins utan
    // ex/V/GX-kort ("Pokémon GO: Poké Ball Tin"). En stor tin med ett unikt kort ("Mega Moonlit Tins: Mega
    // Gengar ex Tin") säljs utan seriens CM-namn — mätt: 4 äkta annonser fälldes när serien alltid krävdes.
    const m = catalogTitle.match(/^(.+?):\s*(.+)$/);
    if (m && /\btins?\b/i.test(catalogTitle)) {
      const chars = norm(m[2]).trim().split(" ").filter((w) => w.length >= 3 && !FORM_WORDS.has(w) && w !== "ex");
      if (chars.length && !chars.some((w) => has(l, w))) return "annan karaktär på tinen";
      const uniqueCard = /\b(?:ex|gx|v|vmax|vstar)\b/.test(norm(m[2]));
      if (/\bmini tins?\b/i.test(catalogTitle) || !uniqueCard) {
        const series = norm(m[1]).trim().split(" ").filter((w) => w.length >= 2 && !FORM_WORDS.has(w));
        const missing = series.filter(
          (w) => !has(l, w) && !has(l, `${w}s`) && !has(l, w.replace(/s$/, "")) && !(w === "30th" && /\b30\b/.test(l))
        );
        // En stavfelsmarginal i långa serienamn ("Black Bolt & Whitle Flare").
        if (missing.length > (series.length >= 4 ? 1 : 0)) return `annan tin-serie (saknar "${missing.join(" ")}")`;
      }
    }
    const cv = c.match(/\b(eu|us|usa) version\b/)?.[1];
    const lv = l.match(/\b(eu|us|usa) version\b/)?.[1];
    if (cv && lv && (cv === "eu") !== (lv === "eu")) return `annan version (${lv.toUpperCase()})`;
  }

  // PREMIUM-STEGEN: Ultra/Super måste stå. ⛔ "Premium Collection" ↔ "ex Box" är INTE en motsägelse:
  // säljare kallar en Premium Collection för "ex box" (katalogen har bara Mega Greninja/Mega Zygarde ex
  // Premium Collection) — mätt mot facit fällde den regeln 4 äkta annonser.
  if (/\bultra premium\b/.test(c) && !/\bultra\b|\bupc\b/.test(l)) return "Ultra-Premium saknas i annonsen";
  if (/\bsuper premium\b/.test(c) && !/\bsuper\b|\bspc\b/.test(l)) return "Super-Premium saknas i annonsen";

  // BOXENS KVALIFICERARE: katalogens ord måste stå i annonsen.
  if (catalogCategory === "BOOSTER_BOX" || catalogCategory === "ETB") {
    if (/\b18 boosters\b/.test(c) && !/\b18\b/.test(l)) return "18-paketsboxen saknas i annonsen";
    if (!/\b18 boosters\b|\bhalf\b/.test(c) && /\b18 ?(?:pack|packs|boosters|paket|st)\b/.test(l)) return "18 paket ≠ katalogens box";
    if (/\bhalf\b/.test(c) && !/\bhalf\b|\bhalv\b|\b18\b/.test(l)) return "Half Display saknas i annonsen";
    if (/\benhanced\b/.test(c) && !/\benhanced\b/.test(l)) return "Enhanced saknas i annonsen";
    if (/\bpokemon center\b/.test(c) && !/\bpokemon center\b|\bpc\b/.test(l)) return "Pokémon Center saknas i annonsen";
    if (/\bempty\b|\bendast box\b/.test(c) && !/\bempty\b|\btom\b|\btomma?\b|\bendast\b|\bbara\b/.test(l)) return "tom ask saknas i annonsen";
  }

  // ANNAT SET i en set-bunden samlarvara ("Lost Origin: Build & Battle Stadium" ← Silver Tempest). En
  // era-produkt ("Sword & Shield: Build & Battle Kit") fälls av ETT ANNAT set ur eran i annonsen.
  if (catalogCategory === "COLLECTION_BOX" && /\bbuild battle\b|\bstadium\b/.test(c) && setNames.length) {
    const sets = setNames.map((s) => norm(s).trim());
    const cSets = setsIn(c, sets);
    const lSets = setsIn(l, sets);
    const cOwn = cSets.filter((s) => !ERA_SETS.includes(s));
    const lOwn = lSets.filter((s) => !ERA_SETS.includes(s));
    // ⛔ Bara set mot set. En era-produkt ("Sword & Shield: Build & Battle Kit") fälls INTE av ett set ur
    //    eran — CM:s namngivning av de äldre kitten är oklar, och en gissning döljer äkta annonser.
    if (cOwn.length && lOwn.length && !lOwn.some((s) => cOwn.includes(s))) return `annat set (${lOwn[0]})`;
  }
  return null;
}
