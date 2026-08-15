/**
 * VILKEN SORTS SEALED-VARA ÄR ANNONSEN? — EN definition, delad av alla adaptrar.
 *
 * Funktionen fanns i TIO nästan identiska kopior (en per adapter) och hade redan
 * drivit isär: tre av dem testade `/etb/i` och `/tin\b/` UTAN inledande ordgräns, så
 * tyska "Karmesin" och namn som "Martin" klassades som TIN. Samma familj av fel som
 * `isSealedCategory` samlades ihop för.
 *
 * ⛔ KATEGORIN ÄR INGEN ETIKETT — DEN AVGÖR OM VARAN EXISTERAR FÖR OSS.
 * `OTHER` står i HIDDEN_CATEGORIES (services/products.ts), vilket ger tre följder:
 *   1. produkten syns inte i katalogen (buildProductWhere filtrerar bort den),
 *   2. restock-larm hoppas över (`hidden`-grinden i runner.ts),
 *   3. feed-först-grenen SKAPAR den aldrig (SEALED_FEED_CATEGORIES saknar OTHER).
 * En riktig SKU som faller till OTHER är alltså osynlig, tyst och oimporterbar.
 *
 * MÄTT 2026-08-15 mot alla 42 bevakade butikers levande feedar: 479 annonser
 * passerade HELA vaktkedjan (språk, denylist, tillbehör, merch, singlar, annan
 * franchise, positiv Pokémon-evidens) utan att ha en offer — och 436 av dem, 91 %,
 * stoppades enbart av att `guessCategory` inte kände igen formen. Det var
 * produktlinjer ordlistan aldrig fått: World Championship Decks, League Battle Decks,
 * Build & Battle-boxar, Trainer Toolkits, Starter Sets, Premium Deck Sets,
 * 30th Celebration-boxarna, promo-paket.
 *
 * ⛔ EN NY REGEL FÅR ALDRIG SLÄPPA IN TILLBEHÖR. Kategorin sätts EFTER vaktkedjan i
 * ensureListingProduct, så tillbehör/merch är redan bortsorterade när den här körs —
 * men den körs också i adaptrarna, före allt annat, och en `COLLECTION_BOX`-etikett på
 * en pärm hade gjort pärmen synlig i katalogen. Därför är orden nedan formord för
 * TILLVERKARENS produktlinjer, aldrig generiska ord som "box" eller "set" ensamma.
 */

/** De sju kategorierna feed-först-grenen accepterar + restkategorin. */
export type ListingCategory =
  | "BOOSTER_BOX"
  | "BOOSTER_PACK"
  | "ETB"
  | "COLLECTION_BOX"
  | "TIN"
  | "BLISTER"
  | "BUNDLE"
  | "OTHER";

/**
 * Ordningen är betydelsebärande: den MEST specifika formen först, för titlarna staplar
 * ord på varandra ("Elite Trainer Box" innehåller "Box", "Booster Bundle" innehåller
 * "Bundle"). Varje rad nedan flyttades hit oförändrad från adaptrarnas kopior, med
 * ordgränserna normaliserade till den strängaste varianten som fanns.
 */
export function guessListingCategory(title: string): ListingCategory {
  const t = title.toLowerCase();

  // ── Displayer/boxar med boosters ───────────────────────────────────────────
  if (/booster\s*(box|display)/.test(t)) return "BOOSTER_BOX";
  // "Display" ensamt är butikernas vanligaste ord för en boosterbox på svenska/tyska
  // ("Display / Booster Box", "36er Display"). Kräver sällskap av booster/pack för att
  // inte fånga skyltdockor och akrylställ — de fälls redan av tillbehörsvakten, men
  // den här funktionen körs också fristående i adaptrarna.
  if (/\bdisplay\b/.test(t) && /\b(booster|pack|packs)\b/.test(t)) return "BOOSTER_BOX";

  // ── Elite Trainer Box ──────────────────────────────────────────────────────
  // ⛔ `\betb\b` med BÅDA ordgränserna. Tre adaptrar hade `/etb/i` utan gränser.
  if (/elite\s*trainer|\betb\b/.test(t)) return "ETB";

  // ── Bundles ────────────────────────────────────────────────────────────────
  if (/booster\s*bundle/.test(t)) return "BUNDLE";

  // ── Paket med boosters ─────────────────────────────────────────────────────
  if (/booster\s*pack|\bbooster\b/.test(t)) return "BOOSTER_PACK";

  // ── Boxade samlingar ───────────────────────────────────────────────────────
  if (/collection\s*box|premium\s*collection/.test(t)) return "COLLECTION_BOX";

  // ── Tin ────────────────────────────────────────────────────────────────────
  // ⛔ `\btin\b` med BÅDA ordgränserna: utan den inledande matchar tyska "Karmesin"
  //    (Scarlet) och engelska "Martin"/"Latin".
  if (/\btin\b/.test(t)) return "TIN";

  if (/blister/.test(t)) return "BLISTER";
  if (/bundle/.test(t)) return "BUNDLE";

  // ── NYA FORMER (2026-08-15) ────────────────────────────────────────────────
  // Allt nedanför hamnade tidigare i OTHER, dvs osynligt + tyst + oimporterbart.
  // Varje rad står för en produktlinje som FAKTISKT förekom i butikernas feedar.

  // Kvalificerade "… Collection" är egna produktlinjer (figur/affisch/pin/klistermärke/
  // specialsamling) och alla innehåller boosters. "Premium Figure Collection" träffas
  // INTE av `premium\s*collection` ovan — orden står inte intill varandra — så hela
  // linjen föll till OTHER trots att katalogen redan har åtta av dem.
  // ⛔ MÅSTE STÅ EFTER blister/tin, aldrig före (mätt 2026-08-15): sex av Aquitaz
  //    "Ascended Heroes **Tech Sticker Collection Blister** (Gastly) (3 Pack)" bytte
  //    annars BLISTER → COLLECTION_BOX. En blister är en blister; kvalificeringen
  //    beskriver vad som ligger I den, inte formen.
  if (/\b(figure|poster|pin|sticker|special)\s*collection\b/.test(t)) return "COLLECTION_BOX";

  // Byggda lekdäck som säljs sealed. "Deck" ensamt är FÖRBJUDET — "Deck Box" och
  // "Deck Protector" är tillbehör, och "deck sleeves" likaså.
  // ⛔ `championships?` — butikerna skriver BÅDE "World Championship Deck" (Alphaspel)
  //    och "World Championships Deck" (Speltrollet, fyra 2024-deck). Ett saknat "s"
  //    lämnade dem i OTHER.
  // ⛔ `start deck` utöver `starter deck`: den japanska linjen heter "MEGA Start Deck
  //    100 Battle Collection", inte "Starter".
  if (
    /\b(world\s*championships?|league\s*battle|battle|theme|starter|start|premium\s*deck|trainer'?s?)\s*deck\b/.test(t) ||
    /\bdeck\s*set\b/.test(t) ||
    /\bv-?battle\s*deck\b/.test(t) ||
    /\bbattle\s*academy\b/.test(t)
  ) {
    return "COLLECTION_BOX";
  }

  // Pokémon Centers "Special Box" är en egen sealed-linje ("Shiny Star V Crobat
  // Special Box", "Special Box Pokemon Center Tohoku"). Bart "box" vore alldeles för
  // brett; frasen är det inte.
  if (/\bspecial\s*box\b/.test(t)) return "COLLECTION_BOX";

  // Build & Battle Box / Stadium — sealed prerelease-paket med fyra boosters.
  if (/build\s*(&|and|\+|\s)*\s*battle/.test(t)) return "COLLECTION_BOX";

  // Trainer Toolkit / Trainer's Toolkit — årlig sealed-SKU.
  if (/trainer'?s?\s*tool\s*kit|trainer'?s?\s*toolkit/.test(t)) return "COLLECTION_BOX";

  // Starter Set / Mega Starter Set — "set" ensamt är FÖRBJUDET (för generiskt).
  if (/\bstarter\s*(set|kit|pack)\b/.test(t)) return "COLLECTION_BOX";

  // Gåvo-/present-/specialboxar tillverkaren säljer som egen SKU.
  if (/\b(gift\s*(box|set)|presentbox|special\s*collection|surprise\s*box|futuristic\s*box)\b/.test(t)) {
    return "COLLECTION_BOX";
  }

  // Promo-paket (First Partner-packs, GO Promo Pack, Trick or Trade). Formen är ett
  // paket kort → BOOSTER_PACK, samma hylla en kund letar i.
  if (/\bpromo\s*(pack|pakke|paket)\b|\btrick\s*or\s*trade\b/.test(t)) return "BOOSTER_PACK";

  // "Half Booster Box"/"halv display" fångas redan ovan av booster-reglerna.
  return "OTHER";
}
