/**
 * IMPORT-DENYLIST: butiks-URL:er som ALDRIG ska bli katalogprodukter.
 *
 * Auto-importen (ensureListingProduct) skapar en produkt för varje NY sealed butiks-URL.
 * En del butikslistningar är tillbehör (suddgummin/pennfodral/mini-album) eller generiska
 * SORTIMENT ("1st random Tin", generisk checklane/blister) som ägaren INTE vill ha i
 * katalogen. Raderar man bara produkten återskapar nästa import den — URL:en finns kvar i
 * butiksfeeden. Den här listan gör raderingen PERMANENT: URL:en avvisas vid import.
 *
 * Lägg till en URL här när ägaren säger "ta bort den här och låt den inte komma tillbaka".
 * (Ett riktigt admin-UI vore bättre om listan växer — men en committad lista räcker länge
 * och kostar noll runtime.) Matchning sker på NORMALISERAD URL, se normUrl.
 */

/**
 * Normaliserar en URL för jämförelse: gemener, utan hash, utan avslutande slash,
 * och utan query — MED ETT UNDANTAG: `variant` behålls.
 *
 * ⛔ VARFÖR UNDANTAGET FINNS (2026-08-13). Shopifys `?variant=` ÄR annonsens identitet:
 *    vår egen ShopifyAdapter delar en produktsida i en annons per variant, och en
 *    butik som Rogerz säljer åtta olika varor (fyra omslag × två momsordningar) på
 *    EN sida. Med query-strippning blev alla åtta samma nyckel, så att neka EN
 *    variant nekade HELA sidan — inklusive den variant som lagligen sitter på den
 *    kanoniska produkten. Följden: kanonprodukten hoppas över i skraparen
 *    (`runner.ts` avvisar nekade URL:er även när offern redan finns), priset fryser
 *    och offern dör. Mätt: 22 kanoniska vintage-produkter — Aquapolis, Expedition,
 *    Arceus … — hade sin LEVANDE Rogerz-offer nekad.
 *
 * ⛔ OCH DET SLOG BREDARE ÄN SÅ: `.../Products?idProduct=271864` normaliserades till
 *    `.../products`, så EN inlagd Cardmarket-URL nekade varje Cardmarket-produkt.
 *    Marknadsplats-URL:er hör aldrig hemma i listan (den läses bara av
 *    ensureListingProduct, som skapar produkter ur BUTIKSFEEDAR) — de som råkade
 *    hamna här är borttagna.
 *
 * ⛔ Övriga parametrar strippas fortfarande med flit: `?utm_source=…`, `?ref=…` och
 *    liknande spårning ändrar inte vilken vara sidan säljer.
 */
export function normalizeListingUrl(u: string): string {
  const trimmed = u.trim().toLowerCase();
  const [path, query = ""] = trimmed.replace(/#.*$/, "").split("?");
  const variant = new URLSearchParams(query).get("variant");
  const base = path.replace(/\/+$/, "");
  return variant ? `${base}?variant=${variant}` : base;
}

// Nekade URL:er (redan normaliserade). Grupperade efter borttagen produkt.
const DENIED = new Set<string>(
  [
    // Goblinens "Mega Zygarde ex Premium Collection" (ägarverdikt 2026-08-11, GTIN-
    // revisionen): sidan säljer INTE vår Zygarde-UPC trots att slugen matchar produkt-
    // namnet exakt — utan denylist hade nästa import bundit om samma fellänk direkt.
    "https://goblinen.com/products/pokemon-tcg-mega-zygarde-ex-premium-collection",
    // "2 Booster Packs & Smoliv or Lechonk Eraser" (tillbehör: suddgummi)
    "https://www.swepoke.se/pokemon/blister-packs/pokemon-eraser-lechonk-smoliv-2-pack",
    "https://dragonslair.se/products/pokemon-tcg-2-booster-packs-smoliv-or-lechonk-eraser-pokemon",
    // "Back to School - 2 Booster Packs & Eraser" (tillbehör: pennfodral)
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-back-to-school-pennfodral-2024.html",
    "https://dragonslair.se/products/pokemon-tcg-back-to-school-2-booster-packs-eraser",
    // "2026 Spring Mini Album with Booster" (tillbehör: mini-album/pärm)
    "https://www.maxgaming.se/sv/pokemon/pokemon-mini-album-med-booster-q1-26",
    "https://www.webhallen.com/se/product/396737",
    "https://samlarhobby.se/products/pokemon-2026-spring-mini-album-with-booster",
    "https://dragonslair.se/products/pokemon-tcg-phantasmal-flames-booster-mini-parm-pokemon",
    // "Mega Evolution Checklane Booster" (generisk, karaktärslös)
    "https://www.maxgaming.se/sv/pokemon/pokemon-mega-evolution-checklane-booster",
    // "Mega Evolution 2.5: Ascended Heroes - 1st random Tin" (generiskt sortiment)
    "https://dragonslair.se/products/pokemon-tcg-mega-evolution-ascended-heroes-mini-tin",
    "https://www.maxgaming.se/sv/pokemon/pokemon-me25-ascended-heroes-mini-tin",
    "https://www.swepoke.se/pokemon/tins/pokemon-ascended-heroes-mini-tin-forhandsbokning",
    "https://samlarhobby.se/products/pokemon-mega-evolution-2-5-ascended-heroes-1st-random-tin",
    // "Sun & Moon: Guardians Rising, 1 Blister pack" (generisk blister, ingen match)
    "https://samlarhobby.se/products/pokemon-sun-moon-guardians-rising-1-blister-pack",
    // "Fall Tin - Paradox Destinies Tin" (generisk "random tin", mappar ej till en karaktär)
    "https://speltrollet.se/products/pok85844",
    // "Pokémon TCG: Kanto Power Mini Tin" (generisk sortiment-tin — de specifika
    // Kanto Power-tinsen finns som egna produkter; den här generiska ska bort)
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-kanto-power-mini-tin.html",
    // 2026-07-18 — ägaren rensade dubbletter/tillbehör bland sealed-stubbar utan CM-länk.
    // Mini-portfolio+booster (tillbehör som inte ska i katalogen alls):
    "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-temporal-forces-mini-portfolio-plus-1-booster-pokemon",
    "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-stellar-crown-mini-portfolio-plus-1-booster",
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-fall-2024-mini-portfolio-booster.html",
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-spring-2025-mini-portfolio-booster.html",
    "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-journey-together-mini-portfolio-booster-pokemon",
    "https://www.maxgaming.se/sv/pokemon/scarlet-violet-9-journey-together-mini-album-booster",
    "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-obsidian-flames-mini-portfolio-plus-booster-pokemon",
    "https://dragonslair.se/products/pokemon-tcg-mega-evolution-mini-portfolio-booster-pokemon",
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-mega-evolution-fall-2025-mini-portfolio-booster.html",
    "https://speltrollet.se/products/pokemon-mega-evolution-fall-2025-mini-portfolio-booster",
    "https://www.swepoke.se/pokemon/booster-packs/pokemon-mega-evolution-fall-2025-mini-portfolio-plus-1-booster-pack",
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-fall-2026-mini-portfolio-booster.html",
    "https://dragonslair.se/products/pokemon-tcg-mini-portfolio-with-booster-pack-pokemon",
    // Generiska dubblett-blistrar/booster (de karaktärsspecifika CM-produkterna finns kvar):
    "https://speltrollet.se/products/pokemon-mega-evolution-perfect-order-3-pack-blister",
    "https://samlarhobby.se/products/pokemon-mega-evolutions-me03-perfect-order-1-blister-pack",
    "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-journey-together-checklane-blister-pokemon",
    "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-journey-together-3-pack-blister-pokemon",
    "https://samlarhobby.se/products/pokemon-mega-evolutions-me04-chaos-rising-checklane-toxel",
    "https://www.maxgaming.se/sv/pokemon/pokemon-me04-chaos-rising-checklane-booster",
    "https://www.alphaspel.se/1762-pokemon-tcg/349393-pokemon-tcg-mega-evolution-chaos-rising-checklane-blister",
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-chaos-rising-checklane-toxel.html",
    "https://manatorsk.com/products/pokemon-checklane-mega-evolution-4-0-toxel",
    "https://dragonslair.se/products/pokemon-tcg-mega-evolution-chaos-rising-checklane-blister-pokemon",
    "https://www.webhallen.com/se/product/398333",
    "https://speltrollet.se/products/pokemon-me04-chaos-rising-checklane-booster",
    // #18 MaxGaming-dubblettlistning (store-länkarna flyttas till Makuhita 1-Pack, denna släpps):
    "https://www.maxgaming.se/sv/pokemon/pokemon-mega-evolution-checklane-booster",
    // DL "Lucario ex Battle Deck" (vanlig 60-korts battle deck, ~239 kr) — fel-matchades
    // upprepat till "Mega Lucario ex LEAGUE Battle Deck" (annan produkt, ~529 kr). Vi har
    // ingen vanlig Lucario ex Battle Deck-produkt → neka så länken inte återuppstår.
    "https://dragonslair.se/products/the-pokemon-tcg-lucario-ex-battle-deck",
    // ── Ägarbeslut 2026-08-07: inga tillbehör, inga butiksegna bundles ──────────
    // Tillbehör (plastfodral). `isAccessoryListing` fångar dem numera vid importen,
    // men URL:erna står här också: den vakten bygger på TITELN, och en butik som
    // döper om produkten hade smugit in dem igen.
    "https://speltrollet.se/products/evoretro-pet-protectors-for-elite-trainer-boxes-5-pack",
    "https://speltrollet.se/products/evoretro-pet-protectors-for-pokemon-booster-display-boxes-5-pack",
    // Butiksegna bundles: en "mystery box" och fem tins sålda i klump är butikens
    // egen hopsättning, inte en tillverkar-SKU — de har inget pris att jämföra
    // mellan butiker och hör därför inte hemma i en priskatalog.
    "https://www.swepoke.se/pokemon/mystery-box/swepoke-mysterybox",
    // Tradera-annons för samma sortiments-tin. En Tradera-ITEM-URL bär identiteten i
    // SÖKVÄGEN och normaliseras därför precist — till skillnad från Cardmarket, vars
    // idProduct ligger i queryn och som därför aldrig får stå i den här listan.
    "https://www.tradera.com/item/1001341/742200148/pokemon-tcg-luminous-city-mini-tins",
    "https://manatorsk.com/products/pokemon-mini-tin-luminose-city-alla-fem-tins-max-1st-per-hushall",
    // ── Ägarens kataloggenomgång 2026-08-08 (apply-owner-catalog-cleanup-2026-08-08.ts) ──
    // Black Bolt & White Flare-kombon: ägaren markerade butikslänkarna som FEL —
    // Samlarhobby-URL:en säljer i själva verket ett Victini File Set.
    "https://samlarhobby.se/products/pokemon-scarlet-violet-white-flare-black-bolt-victini-file-set",
    "https://tinymisters.com/products/pokemon-scarlet-violet-black-bolt-och-white-flare-booster-boxes-japansk",
    // Tillbehör i klump med booster (mini-portfolio/mini-album/jumbo-mynt):
    "https://cardclub.se/products/pokemon-tcg-journey-together-booster-pack-mini-portfolio",
    "https://fantasianorth.com/sv/produkt/pokemon-tcg-2026-spring-mini-album-with-booster/",
    "https://www.shinycards.se/tillbehor/pokemon-scarlet-violet-151-ultra-premium-collection-jumbo-mynt",
    // Icke-Pokémon (Naruto TCG) — Pokétalk säljer även andra spel. Franchise-vakten
    // fångar dem numera på titeln, men URL:erna står här också (samma skäl som
    // tillbehören ovan: en omdöpt produkt hade annars smugit in igen):
    "https://www.poketalk.se/products/naruto-mythos-tcg-first-set-special-pack-collection-box",
    "https://www.poketalk.se/products/naruto-mythos-tcg-konoha-shido-2nd-edition-booster-box-kopia",
    "https://www.poketalk.se/products/naruto-mythos-tcg-konoha-shido-1st-edition-booster-box",
    "https://www.poketalk.se/products/naruto-mythos-tcg-konoha-shido-2nd-edition-booster-pack",
    "https://www.poketalk.se/products/naruto-mythos-tcg-konoha-shido-1st-edition-booster-pack",
    // "SV1 Base Set Sleeved Booster" (ägaren: radera):
    "https://hobbykort.se/products/pokemon-scarlet-violet-base-set-booster-pack",
    // Lumiose City "1st random Tin" (generiskt sortiment, en URL per butik):
    "https://rgbkingz.com/products/pokemon-tcg-lumiose-city-mini-tin",
    "https://samlarhobby.se/products/pokemon-lumiose-city-mini-tin-1st-random-tin",
    "https://spelgalaxen.se/products/pokemon-ascended-heroes-mini-tin-2-pack-en-copy",
    "https://fantasianorth.com/sv/produkt/pokemon-tcg-lumiose-city-mini-tin/",
    "https://mysteryshack.se/products/pokmon-mini-tin-june",
    "https://rahtech.se/products/pokemon-lumiose-city-mini-tin",
    "https://cardclub.se/products/pokemon-tcg-2026-summer-lumiose-city-mini-tin",
    "https://dragonslair.se/products/pokemon-tcg-lumiose-city-mini-tins",
    "https://miniaturemetropolis.se/products/pokemon-tcg-mini-tin-june",
    "https://speltrollet.se/products/pokemon-tcg-lumiose-city-mini-tin-1st",
    // 151 mini-tin UTAN boosters ("Boosters ingår ej") — normUrl kapar ?variant=,
    // så basen täcker alla nio karaktärsvarianterna på samma sida:
    "https://tcgstore.se/products/pokemon-scarlet-violet-151-mini-tin-art-card-coin",
    // Generiska sortiment-tins (assorted/ospecificerad):
    "https://tcgstore.se/products/pokemon-scarlet-violet-8-5-prismatic-evolutions-mini-tin",
    "https://cardgame.se/engelska-pokmon-produkter/engelska-tins/prismatic-evolutions-mini-tin",
    // Shinycards "nyheter"-sida (Collector's Chest 2025 — ägaren: radera):
    "https://www.shinycards.se/nyheter/pokemon-collectors-chest-2025-release-512",
    // ── Ägarens svar på svepningens sektion 2 (apply-owner-sweep-answers-2026-08-08.ts):
    "https://www.poketalk.se/products/pokemon-scarlet-violet-prismatic-tech-sticker-collection-3-pack-blister",
    "https://dragonslair.se/products/pokemon-tcg-2-pack-blister-2024-pokemon",
    // "Long crimp"-vintagepåse (samlarobjekt graderat på krympningen, ingen katalog-SKU):
    "https://samlarhobby.se/products/pokemon-team-rocket-long-crimp-1-booster-gyarados-artwork",
    // Icke-Pokémon: "KPop Demon Hunters" (hittad av ägaren — blocklistan kände inte
    // franchisen; numera stoppar även den positiva vakten hasPokemonTitleSignal den):
    "https://beamcardshop.com/products/kpop-demon-hunters-energy-edition-booster-box",
    // Kanto Vault-stubbar som ÅTERUPPSTOD efter merge (offern föll bort som konflikt
    // → URL:en blev herrelös → nästa skanning skapade om produkten):
    "https://kantovault.se/products/white-flare-deluxe-booster-box-japansk",
    "https://kantovault.se/products/black-bolt-deluxe-booster-box-japansk",
    // ── Ägarens andra svarsomgång (apply-owner-sweep-answers-2-2026-08-08.ts):
    // Xerneas-blistern, butiksbundlar av två boxar/båda ETB:erna, Y & X-tin-listningen.
    "https://cardgame.se/engelska-pokmon-produkter/engelska-2-3-pack-blizters/xy-3-pack-blister-xerneas-xy-breakthrough",
    "https://kantovault.se/products/black-bolt-white-flare-booster-box-bundle-japansk",
    "https://kantovault.se/products/black-bolt-white-flare-deluxe-booster-box-bundle-japansk",
    "https://beamcardshop.com/products/spring-tin-2026",
    "https://www.poketalk.se/products/pokemon-scarlet-violet-black-white-elite-trainer-box",
    // ── Katalogsvepningen 2026-08-08, sektion 3 (apply-sweep-section1-2026-08-08.ts):
    // generiska random tin-/sortimentslistningar, samma familj som Lumiose "1st random".
    "https://rahtech.se/products/pokemon-ascended-heroes-elite-trainer-box-engelsk-copy",
    "https://beamcardshop.com/products/ascended-heroes-mini-tin",
    "https://beamcardshop.com/products/crown-zenith-mini-tin",
    "https://blindbox.se/products/pokemon-black-white-mini-tin",
    "https://blindbox.se/products/pokemon-mega-heroes-mini-tin",
    "https://beamcardshop.com/products/pokemon-mega-evolutions-mega-heroes-mini-tin",
    "https://cardgame.se/engelska-pokmon-produkter/engelska-tins/mega-heroes-mini-tin-2-pack",
    // Släppta vid merge (målet hade redan butikens offer via en annan URL) — utan
    // denylist kan de återuppstå som stubbar vid nästa import:
    "https://dragonslair.se/products/pokemon-25th-anniversary-celebrations-pokemon",
    "https://cardgame.se/engelska-pokmon-produkter/packbattle/packbattle-mega-evolution-booster-pack",
    "https://cardgame.se/engelska-pokmon-produkter/packbattle/packbattle-crown-zenith-boosster-pack-2026-05-08-2300",
    // ── Ägarens kataloggenomgång 2026-08-10 (apply-owner-catalog-cleanup-2026-08-10.ts) ──
    // Raderade produkter som ALDRIG ska tillbaka:
    // "Pokemon Evolving Skies/Astral Radiance Blister: Eevee" (ägaren: radera):
    "https://theswedishfish.se/product/pokemon-evolving-skies-astral-radiance-blister-eevee/",
    // "Battle Academy 2022" (ägaren: tillbehör/brädspel, inte katalogvara):
    "https://www.webhallen.com/se/product/345269",
    "https://beamcardshop.com/products/pokemon-battle-academy",
    // Pokemurres "EJ SEALED"-listning av Storm Emeralda-boxen: katalogen länkar
    // den FÖRSEGLADE listningen; en oförseglad box är inte katalogprodukten.
    // Utan denylist återuppstår URL:en som stub efter mergen (offern föll bort
    // som konflikt → URL:en blev herrelös — samma fälla som Kanto Vault-stubbarna).
    "https://pokemurre.se/products/forbokning-pokemon-mega-storm-emeralda-m6-booster-box-ej-sealed-japansk",
    // Kanto Vaults "30th Celebration Card Set": placeholder-sida (1 kr, slut) som
    // felländes till engelska 30th Celebration Booster — oklar SKU, ingen katalogvara.
    "https://kantovault.se/products/pokemon-30th-celebration-card-set",
    // ── Dubblettsvepningen 2026-08-11 (apply-owner-catalog-cleanup-2026-08-11.ts) ──
    // DL:s KARAKTÄRSLÖSA Destined Rivals-blisterssida låg som offer på BÅDE Kangaskhan-
    // och Zebstrika-blistern (samma URL, ingen variant). CM:s blistrar är per karaktär —
    // en karaktärslös sida kan inte länkas till någon av dem (samma regel som
    // journey-together-blistrarna ovan).
    "https://dragonslair.se/products/pokemon-tcg-scarlet-violet-10-destined-rivals-3-pack-blister-pokemon",
    // Pokétalks "UTAN PLAST"-listning av PE-bundlen: föll bort som konflikt vid mergen
    // (målet har redan Pokétalks ordinarie listning) — utan denylist återuppstår stubben.
    "https://www.poketalk.se/products/pokemon-scarlet-violet-prismatic-evolutions-booster-bundle-1",
    // ── Ägarens katalogbeslut 2026-08-13 (apply-owner-decisions.ts) ──
    // [JP] Pokémon BOOSTERPACK - Glory of Team Rocket (SV10) (offer krockar med målets)
    // Inferno X Booster Pack Japansk (offer krockar med målets)
    // Pokémon WOTC: Neo Genesis Booster Pack - Feraligatr (offer krockar med målets)
    "https://www.poketalk.se/products/pokemon-wotc-neo-genesis-booster-pack?variant=52365478461782",
    // Pokémon WOTC: Neo Genesis Booster Pack - Meganium (offer krockar med målets)
    "https://www.poketalk.se/products/pokemon-wotc-neo-genesis-booster-pack?variant=52365478429014",
    // Pokémon WOTC: Neo Genesis Booster Pack - Lugia (offer krockar med målets)
    "https://www.poketalk.se/products/pokemon-wotc-neo-genesis-booster-pack?variant=52365478396246",
    // Pokémon Mega: Nihil Zero (M3) Booster – JAPANSK (offer krockar med målets)
    "https://cardgame.se/engelska-pokmon-produkter/japansktkinesiskt/booster-boxar/nihil-zero-japansk",
    // [JP] Pokémon BOOSTERPACK - Cyber Judge (SV5M) (offer krockar med målets)
    // [JP] Pokémon BOOSTERPACK - Stellar Miracle (SV7) (offer krockar med målets)
    // Pokémon Scarlet & Violet: Stellar Miracle Booster Pack (JP) (offer krockar med målets)
    // [JP] Pokémon BOOSTERPACK - Battle Partners (SV9) (offer krockar med målets)
    // Pokémon Scarlet & Violet: Battle Partners Booster Pack (JP) (offer krockar med målets)
    // [JP] Pokémon BOOSTERPACK - Mega Brave (M1L) (offer krockar med målets)
    // [JP] Pokémon BOOSTERPACK - Mega Symphonia (M1S) (offer krockar med målets)
    // Paldea Evolved 1-Pack Checklane Booster Pack - Smoliv / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-paldea-evolved-1-pack-checklane-booster-pack?variant=51778464252235",
    // Paldea Evolved 1-Pack Checklane Booster Pack - Growlithe / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-paldea-evolved-1-pack-checklane-booster-pack?variant=51778464219467",
    // Dark Explorers Booster Pack (Black & White) - Darkrai / Brugtmoms (offer krockar med målets)
    // Boundaries Crossed Booster Pack (Black & White) - Black Kyurem / Brugtmoms (offer krockar med målets)
    // Boundaries Crossed Booster Pack (Black & White) - Landorus / Brugtmoms (offer krockar med målets)
    // Plasma Freeze Booster Pack (Black & White) - Thundurus / Brugtmoms (offer krockar med målets)
    // Plasma Freeze Booster Pack (Black & White) - Bisharp / Brugtmoms (offer krockar med målets)
    // Plasma Freeze Booster Pack (Black & White) - Deoxys / Brugtmoms (offer krockar med målets)
    // Plasma Freeze Booster Pack (Black & White) - Absol / Brugtmoms (offer krockar med målets)
    // HS Triumphant Booster Pack Artwork Set (raderad produkt)
    "https://rogerz.dk/products/pokemon-hs-triumphant-booster-pack-artwork-set",
    // [S-CHN] Pokémon Jumbo-BOOSTERPACK - Brave Stars (CS5a) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-jumbo-boosterpack-brave-stars-cs5a",
    // [S-CHN] Pokémon Boosterpack - True Mystic (CSV6) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-true-mystic-csv6",
    // [S-CHN] Pokémon Boosterpack - Dark Crystal Blaze (CSV5) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-dark-crystal-blaze-csv5",
    // [S-CHN] Pokémon Jumbo-BOOSTERPACK - Azure Shadows - Roar (CS6a) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-jumbo-booster-azure-shadows-roar-cs6a",
    // [S-CHN] Pokémon BOOSTERPACK - Dynamax Clash: Thunder (CS1a) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-dynamax-clash-thunder-cs1a",
    // [S-CHN] Pokémon Jumbo-BOOSTERPACK - Vivid Portrayals: Indigo (CS2b) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-jumbo-boosterpack-vivid-portrayals-indigo-cs2b",
    // [S-CHN] Pokémon Jumbo-BOOSTERPACK - Vivid Portrayals: Obsidian (CS2a) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-jumbo-boosterpack-vivid-portrayals-obsidian-cs2a",
    // [S-CHN] Pokémon BOOSTERPACK - "Vivid Portrayals: Indigo" (CS2b) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-vivid-portrayals-indigo-cs2b",
    // [T-CHN] Pokémon BOOSTERPACK - Hidden Fates Sonne und Mond (AC1B) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-hidden-fates-sonne-und-mond-ac1b",
    // [T-CHN] Pokémon BOOSTERPACK - Hidden Fates (AC1A) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-hidden-fates-sonne-und-mond-ac1a",
    // [S-CHN] Pokémon BOOSTERPACK - Victory Stars (CS6.5) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-victory-stars-cs6-5",
    // [S-CHN] Pokémon JUMBO-BOOSTERPACK- Azure Shadows - Pursuit (CS6b) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-jumbo-boosterpack-azure-shadows-pursuit-cs6b",
    // [S-CHN] Pokémon BOOSTERPACK Jumbo - Nine Colors Gathering: Friend (CS4a) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-jumbo-nine-colors-gathering-friend-cs4a",
    // [S-CHN] Pokémon BOOSTERPACK - Nine Colors Gathering: Friend (CS4a) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-nine-colors-gathering-friend-cs4a",
    // [S-CHN] Pokémon BOOSTERPACK Jumbo - Nine Colors Gathering: Origin (CS4b) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-jumbo-nine-colors-gathering-origin-cs4b",
    // [S-CHN] Pokémon BOOSTERPACK - "Nine Colors Gathering: Origin" (CS4b) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-nine-colors-gathering-origin-cs4b",
    // [S-CHN] Pokémon BOOSTERPACK - Shining Synergy: Shower (CSM2a) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-shining-synergy-shower-csm2a",
    // [S-CHN] Pokémon BOOSTERPACK - Shining Synergy: Supreme (CSM2b) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-shining-synergy-supreme-csm2b",
    // [S-CHN] Pokémon BOOSTERPACK - Shining Synergy: Summon (CSM2c) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-shining-synergy-summon-csm2c",
    // [S-CHN] Pokémon Jumbo-BOOSTERPACK - Ancient Martial Arts: Overgrow (CS3a) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-ancient-martial-arts-overgrow-cs3a",
    // [S-CHN] Pokémon Jumbo-BOOSTERPACK - Ancient Martial Arts: Torrent (CS3b) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-ancient-martial-arts-torrent-cs3b",
    // [S-CHN] Pokémon BOOSTERPACK - Striking Competition (CSM2.5) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-striking-competition-csm2-5",
    // [S-CHN] Pokémon BOOSTERPACK - tobende Flamme (CS3.5) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-tobende-flamme-cs3-5",
    // [S-CHN] Pokémon BOOSTERPACK - Vivid Portrayals: Obsidian (CS2a) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-vivid-portrayals-obsidian-cs2a",
    // [S-CHN] Pokémon BOOSTERPACK - Brave Stars (CS5a) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-brave-stars-cs5a",
    // [S-CHN] Pokémon BOOSTERPACK - Brave Stars (CS5b) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-brave-stars-cs5b",
    // [S-CHN] Pokémon Jumbo-BOOSTERPACK - Brave Stars (CS5b) (raderad produkt)
    "https://yonko-tcg.de/products/s-chn-pokemon-boosterpack-brave-stars-cs5b-kopie",
    // ── Ägarens katalogbeslut 2026-08-13 (apply-owner-decisions.ts) ──
    // Dragon Storm Booster Box (offer krockar med målets)
    // Tidal Storm Booster Box (offer krockar med målets)
    // Space Juggler Booster Box (s10P)(Japansk) (offer krockar med målets)
    // Shiny Star V Limited Booster Box Set (offer krockar med målets)
    // Evolutions 3-pack Blister (X & Y) - Braixen / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-evolutions-3-pack-blister?variant=46990550270283",
    // Team Up 1-pack Blister (Sun & Moon) - Pikachu / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-team-up-1-pack-blister?variant=47184794747211",
    // Team Up 1-pack Blister (Sun & Moon) - Mimikyu / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-team-up-1-pack-blister?variant=47184794714443",
    // EX Deoxys Booster Pack - Deoxys (Blå) / Brugtmoms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-ex-deoxys-booster-pack?variant=57143756292427",
    // EX Deoxys Booster Pack - Deoxys - (Grøn) / Brugtmoms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-ex-deoxys-booster-pack?variant=57143756259659",
    // EX Deoxys Booster Pack - Deoxys - (Gul) / Brugtmoms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-ex-deoxys-booster-pack?variant=57143756226891",
    // Prismatic Evolutions Pokémon Center Elite Trainer Box (offer krockar med målets)
    // Ascended Heroes Pokémon Center Elite Trainer Box (offer krockar med målets)
    // Mega Evolution Base Set Elite Trainer Box - Gardevoir / Brugtmoms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-mega-evolution-base-set-elite-trainer-box?variant=57143680631115",
    // Mega Evolution Base Set Elite Trainer Box - Lucario / Brugtmoms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-mega-evolution-base-set-elite-trainer-box?variant=57143680598347",
    // Back to School 2023 Eraser Blister Pack - Lechonk/Smoliv - Smoliv / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-back-to-school-2023-eraser-blister-pack-lechonk-smoliv?variant=51403563139403",
    // Back to School 2023 Eraser Blister Pack - Lechonk/Smoliv - Lechonk / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-back-to-school-2023-eraser-blister-pack-lechonk-smoliv?variant=51403563106635",
    // Slashing Legends Collector's Tin - Koraidon / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-slashing-legends-collectors-tin?variant=51860802928971",
    // Slashing Legends Collector's Tin - Zacian / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-slashing-legends-collectors-tin?variant=51860802896203",
    // Greninja Ultra-Premium Collection (offer krockar med målets)
    // Scarlet & Violet - 151 Ultra-Premium Collection (Scarlet & Violet 3.5) (offer krockar med målets)
    // Pokémon Sword & Shield Charizard Ultra-Premium Collection (offer krockar med målets)
    // Pokémon Sword & Shield: Celebrations Ultra-Premium Collection (ENG) (offer krockar med målets)
    // Greninja/Kingdra ex Special Illustration Collection Box (Scarlet & Violet) - Greninja / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-greninja-kingdra-ex-special-illustration-collection?variant=49902071120203",
    // Greninja/Kingdra ex Special Illustration Collection Box (Scarlet & Violet) - Kingdra / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-greninja-kingdra-ex-special-illustration-collection?variant=49902071152971",
    // Abyss Eye Booster Box - Japansk (Mega Evolution) (offer krockar med målets)
    // Poke Ball Tin Fall 2025 (E25) (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-poke-ball-tin-fall-2025",
    // Poké Ball Tin 2025 (raderad produkt)
    "https://tcgstore.se/products/pokemon-tcg-poke-ball-tin-2025",
    // Pokemon GO Pokeball Tin (raderad produkt)
    "https://speltrollet.se/products/of-course-p-p-the-pokemon-tcg-pokemon-go-poke-ball-tin-contains-p-ul-li-3-pokemon-tcg-pokemon-go-booster-packs-li-li-2-sticker-sheets-li-li-br-li-ul",
    // Jungle Booster Box - Unlimited (Belgium edt.) (raderad produkt)
    "https://rogerz.dk/products/jungle-booster-box-unlimited",
    // Gym Heroes Booster Box (Wizards of the Coast) (raderad produkt)
    "https://rogerz.dk/products/pokemon-gym-heroes-booster-box",
    // Gym Challenge Booster Box (Wizards of the Coast) (raderad produkt)
    "https://rogerz.dk/products/pokemon-gym-challenge-booster-box",
    // Neo Genesis Booster Box (Wizards of the Coast) (raderad produkt)
    "https://rogerz.dk/products/pokemon-neo-genesis-booster-box",
    // Scarlet & Violet Anytime, Anywhere Battle Academy (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-anytime-anywhere-battle-academy-collection-box-jp",
    // Gym Heroes Booster Pack - 1st Edition (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-gym-heroes-booster-pack-1st-edition",
    // Gym Challenge Booster Pack - 1st Edition (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-gym-challenge-booster-pack-1st-edition",
    // Jungle Booster Box - 1st Edition (Wizards of the Coast) (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-jungle-booster-box-1st-edition-wizards-of-the-coast",
    // Fossil Booster Box - 1st Edition (Wizards of the Coast) (raderad produkt)
    "https://rogerz.dk/products/pokemon-fossil-booster-box-1st-edition",
    // Team Rocket Booster Box - 1st Edition (Wizards of the Coast) (raderad produkt)
    "https://rogerz.dk/products/pokemon-team-rocket-booster-box-1st-edition",
    // ── Ägarens katalogbeslut 2026-08-13 (apply-owner-decisions.ts) ──
    // Pokemon ME02 Phantasmal Flames Elite Trainer - Speltrollet Collector Edition (offer krockar med målets)
    "https://speltrollet.se/products/pokemon-me02-phantasmal-flames-checklane",
    "https://www.maxgaming.se/sv/pokemon/pokemon-me02-phantasmal-flames-premium-checklane",
    // Pokémon Mega Evolution: Pitch Black Checklane 1-Pack Blister (Aurorus and Amaura) (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-mega-evolution-pitch-black-checklane-1-pack-blister-aurorus-and-amaura-eng",
    // Pokémon Mega Evolution: Pitch Black Checklane 1-Pack Blister (Tyrantrum and Tyrunt) (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-mega-evolution-pitch-black-checklane-1-pack-blister-tyrantrum-and-tyrunt-eng",
    // Pokémon Sword & Shield: Fusion Strike/Chilling Reign Jirachi Pin Blister (2 Pack) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sword-shield-fusion-strike-jirachi-pin-blister-2-pack",
    // Pokémon Sword & Shield: Fusion Strike/Chilling Reign Celebi Pin Blister (2 Pack) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sword-shield-fusion-strike-celebi-pin-blister-2-pack",
    // Pokémon, 25th Anniversary Celebrations, 1 booster pack (raderad produkt)
    "https://samlarhobby.se/products/pokemon-25th-anniversary-celebrations-1-booster-pack",
    // Pokémon Tin: Pokémon GO (raderad produkt)
    "https://tcgstore.se/products/pokemon-tin-pokemon-go-1",
    // Virizion V Collection Box (raderad produkt)
    "https://tcgstore.se/products/pokemon-tcg-virizion-v-collection-box",
    "https://speltrollet.se/products/pokemon-virizion-v-box",
    // Hisuian Electrode V Collection Box (raderad produkt)
    "https://tcgstore.se/products/pokemon-tcg-hisuian-electrode-v-collection-box",
    "https://speltrollet.se/products/pokemon-hisuian-electrode-v-box",
    "https://dragonslair.se/products/pokemon-tcg-hisuian-electrode-v-box-pokemon",
    // Pokémon Collectors Chest Tin Fall 2022: Dialga & Palkia (raderad produkt)
    "https://tcgstore.se/products/pokemon-collectors-chest-tin-fall-2022-dialga-palkia",
    // Pokémon Collectors' Chest Tin Spring 2022: Arceus (raderad produkt)
    "https://tcgstore.se/products/pokemon-collector-s-chest-tin-spring-2022-arceus",
    // Pokémon Sword & Shield: Hisuian Zoroark VSTAR Premium Collection Box (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sword-shield-hisuian-zoroark-vstar-premium-collection-5-pack-eng",
    // Hisuian Zoroark VSTAR Premium Collection Box (raderad produkt)
    "https://tcgstore.se/products/pokemon-tcg-hisuian-zoroark-vstar-premium-collection-box",
    // Pokemon Hisuian Zoroark VSTAR Premium Collection (raderad produkt)
    "https://speltrollet.se/products/pokemon-hisuian-zoroark-vstar-premium-collection",
    // Celebi 2-Pack Pin Blister (Evolving Skies & Chilling Reign) (raderad produkt)
    "https://tcgstore.se/products/pokemon-tcg-celebi-2-pack-pin-blister-evolving-skies-chilling-reign",
    // Jirachi 2-Pack Pin Blister (Evolving Skies & Chilling Reign) (raderad produkt)
    "https://tcgstore.se/products/pokemon-tcg-jirachi-2-pack-pin-blister-evolving-skies-chilling-reign",
    // V Powers Tin - Pikachu V (raderad produkt)
    "https://tcgstore.se/products/pokemon-tcg-v-powers-tin-pikachu-v",
    // V Powers Tin - Eevee (raderad produkt)
    "https://tcgstore.se/products/pokemon-tcg-v-powers-tin-eevee",
    // V Powers Tin - Eternatus V (raderad produkt)
    "https://tcgstore.se/products/pokemon-tcg-v-powers-tin-eternatus-v",
    // Pokémon XY Base Set Sleeved Booster Pack (raderad produkt)
    "https://hobbykort.se/products/pokemon-sv5-temporal-forces-1-sleeved-booster-copypokemon-scarlet-violet-1-sleeved-booster",
    "https://rogerz.dk/products/pokemon-x-y-base-set-booster-pack",
    "https://beamcardshop.com/products/xy-base-sleeved-booster",
    // Pokémon XY Flashfire Sleeved Booster Pack (raderad produkt)
    "https://beamcardshop.com/products/xy-flashfire-sleeved-booster",
    // Pokémon XY BREAKthrough Sleeved Booster Pack (raderad produkt)
    "https://beamcardshop.com/products/breakthrough-sleeved-booster",
    // Pokémon XY BREAKpoint Sleeved Booster Pack (raderad produkt)
    "https://rogerz.dk/products/pokemon-breakpoint-sleeved-booster-pack",
    "https://beamcardshop.com/products/breakpoint-sleeved-booster",
    // Pokémon XY Evolutions Sleeved Booster Pack (raderad produkt)
    "https://aquitaz.se/products/pokemon-xy-evolutions-sleeved-booster-pack-10-kort-eng",
    "https://beamcardshop.com/products/evolutions-sleeved-booster",
    // Pokémon Sun & Moon Base Set Sleeved Booster Pack (raderad produkt)
    "https://aquitaz.se/products/pokemon-sun-moon-base-set-booster-pack-10-kort-eng",
    "https://rogerz.dk/products/sun-moon-base-set-booster-pack",
    "https://beamcardshop.com/products/sun-moon-base-booster-pack",
    // Shining Fates Pin Collection Box Polteageist (raderad produkt)
    "https://beamcardshop.com/products/shining-fates-pin-collection-box-polteageist",
    // Pokémon MEGA Start Deck 100 Battle Collection Box (Japanese) (raderad produkt)
    "https://yonko-tcg.de/products/jp-pokemon-mega-start-deck-100-battle-collection",
    "https://pokemurre.se/products/preorder-pokemon-mega-start-deck-100-battle-collection-box-japanese",
    "https://nordictcg.se/60-mega-start-deck-100-battle-collection-från-förseglat-case.html",
    "https://speltrollet.se/products/pokemon-start-deck-100-battle-collection-japansk",
    "https://aquitaz.se/products/pokemon-mega-100-battle-collection-starter-deck-jp",
    // True Steel Premium Collection - Versionen med 1 Team Up Pack (raderad produkt)
    "https://cardlevels.se/products/pokemon-tcg-true-steel-premium-collection",
    // Pokémon Single Strike Urshifu VMAX Premium Collection Box (ENG) (raderad produkt)
    "https://tcgstore.se/products/pokemon-tcg-single-strike-urshifu-vmax-premium-collection-box",
    "https://aquitaz.se/products/pokemon-single-strike-urshifu-vmax-premium-collection-box-8-pack-eng",
    // Pokémon Mega Evolution: Mega Evolution Checklane Blister (Target Exclusive) (Lycanroc & Rockruff) (E (raderad produkt)
    "https://aquitaz.se/products/pokemon-mega-evolution-checklane-blister-target-exclusive-lycanroc-rockruff-eng",
    // Japansk Ultra Force Bout Booster Kit (raderad produkt)
    "https://pocketmonsters.se/pokemon/japanese-ultra-force-bout-booster-paket/",
    // Pokemon Scarlet & Violet 4.5 - Paldean Fates Premium Collection (raderad produkt)
    "https://speltrollet.se/products/pokemon-scarlet-violet-4-5-paldean-fates-premium-collection",
    // Pokemon Spring Tin 2025 Azure Legends Tin (4 boosters) (raderad produkt)
    "https://hobbykort.se/products/pokemon-tcg-azure-legends-collectors-tin",
    "https://rogerz.dk/products/pokemon-tcg-azure-legends-collectors-tin-box",
    "https://speltrollet.se/products/pokemon-spring-tin-2025-azure-legends-tin",
    // Pokemon Sword & Shield: Pokemon Go Booster (Japansk) (raderad produkt)
    "https://speltrollet.se/products/pokemon-sword-shield-pokemon-go-booster-japansk",
    // Pokemon VMAX Dragons Premium Collection Rayquaza & Duraludon (raderad produkt)
    "https://speltrollet.se/products/pokemon-vmax-dragons-premium-collection",
    // Pokémon Sword & Shield: Pokémon GO Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sword-shield-pokemon-go-booster-pack",
    // Pokemon Chilling Reign Elite Trainer Box (raderad produkt)
    "https://speltrollet.se/products/pokemon-sword-shield-6-chilling-reign-elite-trainer-box",
    // ── Ägarens katalogbeslut 2026-08-13 (apply-owner-decisions.ts) ──
    // XY BreakThrough Elite Trainer Box / Mewtwo Y - Uden hul i folie (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-breakthrough-elite-trainer-box-x-y?variant=57218967503179",
    // Paradox Rift Elite Trainer Box (Scarlet & Violet) - Roaring Moon Elite Trainer Box (blå) (offer krockar med målets)
    "https://rogerz.dk/products/paradox-rift-elite-trainer-box?variant=57143620337995",
    "https://rogerz.dk/products/paradox-rift-elite-trainer-box?variant=46839950377291",
    // Temporal Forces Elite Trainer Box (Scarlet & Violet) - Walking Wake Elite Trainer Box (Blå) (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-temporal-forces-elite-trainer-box?variant=57143629742411",
    "https://rogerz.dk/products/pokemon-temporal-forces-elite-trainer-box?variant=47369355821387",
    // Pokémon Mega: 30th Celebration Sylveon ex Mini Tin (4 Pack) (ENG) (offer krockar med målets)
    "https://aquitaz.se/products/pokemon-mega-30th-celebration-sylveon-ex-mini-tin-4-pack-eng",
    // Base Set 2 Booster Pack - Unlimited - Gyarados artwork (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-base-set-2-booster-pack-unlimited?variant=57143622664523",
    // Base Set 2 Booster Pack - Unlimited - Mewtwo artwork / Brugtmoms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-base-set-2-booster-pack-unlimited?variant=57143622730059",
    // Base Set 2 Booster Pack - Unlimited - Pidgeot artwork / Brugtmoms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-base-set-2-booster-pack-unlimited?variant=57143622697291",
    // Base Set 2 Booster Pack - Unlimited - Raichu artwork / Brugtmoms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-base-set-2-booster-pack-unlimited?variant=57143622762827",
    // Expedition Booster Pack (eSeries) - Charizard (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-expedition-booster-pack?variant=47713725579595",
    "https://rogerz.dk/products/pokemon-expedition-booster-pack?variant=57143633740107",
    // Expedition Booster Pack (eSeries) - Feraligatr (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-expedition-booster-pack?variant=47713725645131",
    "https://rogerz.dk/products/pokemon-expedition-booster-pack?variant=57143633772875",
    // Expedition Booster Pack (eSeries) - Venusaur (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-expedition-booster-pack?variant=47713963442507",
    "https://rogerz.dk/products/pokemon-expedition-booster-pack?variant=57143633805643",
    // Expedition Booster Pack (eSeries) - Blastoise (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-expedition-booster-pack?variant=50330816774475",
    // Aquapolis Booster Pack (eSeries) - Entei (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-aquapolis-booster-pack?variant=47755235492171",
    "https://rogerz.dk/products/pokemon-aquapolis-booster-pack?variant=57143635411275",
    // Aquapolis Booster Pack (eSeries) - Scizor (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-aquapolis-booster-pack?variant=57143635378507",
    // Aquapolis Booster Pack (eSeries) - Tyranitar (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-aquapolis-booster-pack?variant=47755235524939",
    "https://rogerz.dk/products/pokemon-aquapolis-booster-pack?variant=57143635444043",
    // Aquapolis Booster Pack (eSeries) - Arcanine (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-aquapolis-booster-pack?variant=47755235557707",
    "https://rogerz.dk/products/pokemon-aquapolis-booster-pack?variant=57143635476811",
    // Legendary Collection Booster Pack (eSeries) - Venusaur/Charizard/Blastoise (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-legendary-collection-booster-pack?variant=57143633379659",
    "https://rogerz.dk/products/pokemon-legendary-collection-booster-pack?variant=50331164311883",
    // Legendary Collection Booster Pack (eSeries) - Moltres/Articuno/Zapdos (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-legendary-collection-booster-pack?variant=57143633346891",
    "https://rogerz.dk/products/pokemon-legendary-collection-booster-pack?variant=50331164279115",
    // Legendary Collection Booster Pack (eSeries) - Mewtwo/Alakazam/Machamp (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-legendary-collection-booster-pack?variant=57143633281355",
    // Dragon Frontiers Booster Pack (EX Ruby & Sapphire) - Nidoking (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-dragon-frontiers-booster-pack?variant=50410578280779",
    "https://rogerz.dk/products/pokemon-dragon-frontiers-booster-pack?variant=57143646978379",
    // Dragon Frontiers Booster Pack (EX Ruby & Sapphire) - Tyranitar (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-dragon-frontiers-booster-pack?variant=50410578346315",
    "https://rogerz.dk/products/pokemon-dragon-frontiers-booster-pack?variant=57143647011147",
    // Dragon Frontiers Booster Pack (EX Ruby & Sapphire) - Salamence (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-dragon-frontiers-booster-pack?variant=50410601808203",
    "https://rogerz.dk/products/pokemon-dragon-frontiers-booster-pack?variant=57143647043915",
    // Dragon Frontiers Booster Pack (EX Ruby & Sapphire) - Latias/Latios (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-dragon-frontiers-booster-pack?variant=50410601873739",
    // Diamond & Pearl Base Set Booster Pack (Diamond & Pearl) - Lucario (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-diamond-pearl-base-set-booster-pack?variant=57143648584011",
    "https://rogerz.dk/products/pokemon-diamond-pearl-base-set-booster-pack?variant=50445195968843",
    // Diamond & Pearl Base Set Booster Pack (Diamond & Pearl) - Palkia (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-diamond-pearl-base-set-booster-pack?variant=57143648551243",
    "https://rogerz.dk/products/pokemon-diamond-pearl-base-set-booster-pack?variant=50445195936075",
    // Diamond & Pearl Base Set Booster Pack (Diamond & Pearl) - Electivire (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-diamond-pearl-base-set-booster-pack?variant=57143648518475",
    "https://rogerz.dk/products/pokemon-diamond-pearl-base-set-booster-pack?variant=50445138952523",
    // Diamond & Pearl Base Set Booster Pack (Diamond & Pearl) - Dialga (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-diamond-pearl-base-set-booster-pack?variant=50445196001611",
    // Great Encounters Booster Pack (Diamond & Pearl) - Cresselia (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-great-encounters-booster-pack?variant=57143648387403",
    "https://rogerz.dk/products/pokemon-great-encounters-booster-pack?variant=50445007880523",
    // Great Encounters Booster Pack (Diamond & Pearl) - Palkia (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-great-encounters-booster-pack?variant=57143648354635",
    "https://rogerz.dk/products/pokemon-great-encounters-booster-pack?variant=50445007847755",
    // Great Encounters Booster Pack (Diamond & Pearl) - Dialga (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-great-encounters-booster-pack?variant=57143648321867",
    "https://rogerz.dk/products/pokemon-great-encounters-booster-pack?variant=50444893946187",
    // Great Encounters Booster Pack (Diamond & Pearl) - Darkrai (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-great-encounters-booster-pack?variant=50445008765259",
    // Majestic Dawn Booster Pack (Diamond & Pearl) - Darkrai (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-majestic-dawn-booster-pack?variant=57143648190795",
    "https://rogerz.dk/products/pokemon-majestic-dawn-booster-pack?variant=50444821463371",
    // Majestic Dawn Booster Pack (Diamond & Pearl) - Garchomp (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-majestic-dawn-booster-pack?variant=57143648158027",
    "https://rogerz.dk/products/pokemon-majestic-dawn-booster-pack?variant=50444821430603",
    // Majestic Dawn Booster Pack (Diamond & Pearl) - Empoleon (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-majestic-dawn-booster-pack?variant=57143648125259",
    "https://rogerz.dk/products/pokemon-majestic-dawn-booster-pack?variant=50444821397835",
    // Majestic Dawn Booster Pack (Diamond & Pearl) - Hippowdon (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-majestic-dawn-booster-pack?variant=50444821496139",
    // Unleashed Booster Pack (HeartGold SoulSilver) - Entei (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-unleashed-booster-pack?variant=57143647568203",
    "https://rogerz.dk/products/pokemon-unleashed-booster-pack?variant=50438445072715",
    // Unleashed Booster Pack (HeartGold SoulSilver) - Raikou (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-unleashed-booster-pack?variant=57143647535435",
    "https://rogerz.dk/products/pokemon-unleashed-booster-pack?variant=50438445007179",
    // Unleashed Booster Pack (HeartGold SoulSilver) - Crobat (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-unleashed-booster-pack?variant=57143647502667",
    "https://rogerz.dk/products/pokemon-unleashed-booster-pack?variant=50438444974411",
    // Unleashed Booster Pack (HeartGold SoulSilver) - Suicune (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-unleashed-booster-pack?variant=50438513983819",
    // Undaunted Booster Pack (HeartGold SoulSilver) - Houndoom (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-undaunted-booster-pack?variant=57143647404363",
    "https://rogerz.dk/products/pokemon-undaunted-booster-pack?variant=50438379241803",
    // Undaunted Booster Pack (HeartGold SoulSilver) - Rayquaza (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-undaunted-booster-pack?variant=57143647371595",
    "https://rogerz.dk/products/pokemon-undaunted-booster-pack?variant=50438379209035",
    // Undaunted Booster Pack (HeartGold SoulSilver) - Jolteon (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-undaunted-booster-pack?variant=57143647338827",
    "https://rogerz.dk/products/pokemon-undaunted-booster-pack?variant=50438379176267",
    // Undaunted Booster Pack (HeartGold SoulSilver) - Skarmory (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-undaunted-booster-pack?variant=50438379274571",
    // Triumphant Booster Pack (HeartGold SoulSilver) - Electivire (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-triumphant-booster-pack?variant=57143647207755",
    "https://rogerz.dk/products/pokemon-triumphant-booster-pack?variant=50438285492555",
    // Triumphant Booster Pack (HeartGold SoulSilver) - Palkia (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-triumphant-booster-pack?variant=57143647174987",
    "https://rogerz.dk/products/pokemon-triumphant-booster-pack?variant=50438285427019",
    // Triumphant Booster Pack (HeartGold SoulSilver) - Dialga (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-triumphant-booster-pack?variant=57143647142219",
    "https://rogerz.dk/products/pokemon-triumphant-booster-pack?variant=50438285361483",
    // Triumphant Booster Pack (HeartGold SoulSilver) - Magmortar (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-triumphant-booster-pack?variant=50438349259083",
    // Black & White Base Set Booster Pack (Black & White) - Reshiram (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-black-white-base-set-booster-pack?variant=57143646847307",
    "https://rogerz.dk/products/pokemon-black-white-base-set-booster-pack?variant=50405601182027",
    // Black & White Base Set Booster Pack (Black & White) - Zoroark (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-black-white-base-set-booster-pack?variant=57143646814539",
    "https://rogerz.dk/products/pokemon-black-white-base-set-booster-pack?variant=50405572149579",
    // Black & White Base Set Booster Pack (Black & White) - Zebstrika (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-black-white-base-set-booster-pack?variant=57143646781771",
    "https://rogerz.dk/products/pokemon-black-white-base-set-booster-pack?variant=50405572084043",
    // Black & White Base Set Booster Pack (Black & White) - Zekrom (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-black-white-base-set-booster-pack?variant=50405601214795",
    // Emerging Powers Booster Pack (Black & White) - Cobalion (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-emerging-powers-booster-pack?variant=57143646683467",
    "https://rogerz.dk/products/pokemon-emerging-powers-booster-pack?variant=50405487542603",
    // Emerging Powers Booster Pack (Black & White) - Braviary (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-emerging-powers-booster-pack?variant=57143646650699",
    "https://rogerz.dk/products/pokemon-emerging-powers-booster-pack?variant=50405487509835",
    // Emerging Powers Booster Pack (Black & White) - Darmanitan (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-emerging-powers-booster-pack?variant=57143646617931",
    "https://rogerz.dk/products/pokemon-emerging-powers-booster-pack?variant=50405487477067",
    // Emerging Powers Booster Pack (Black & White) - Tornadus (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-emerging-powers-booster-pack?variant=50405514445131",
    // Next Destinies Booster Pack (Black & White) - Reshiram (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-next-destinies-booster-pack?variant=57143646486859",
    "https://rogerz.dk/products/pokemon-next-destinies-booster-pack?variant=50405407392075",
    // Next Destinies Booster Pack (Black & White) - Regigigas (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-next-destinies-booster-pack?variant=57143646454091",
    "https://rogerz.dk/products/pokemon-next-destinies-booster-pack?variant=50405407359307",
    // Next Destinies Booster Pack (Black & White) - Mewtwo (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-next-destinies-booster-pack?variant=57143646421323",
    "https://rogerz.dk/products/pokemon-next-destinies-booster-pack?variant=50405407326539",
    // Next Destinies Booster Pack (Black & White) - Zekrom (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-next-destinies-booster-pack?variant=50405407424843",
    // Dark Explorers Booster Pack (Black & White) - Excadrill (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-dark-explorers-booster-pack?variant=57143646093643",
    "https://rogerz.dk/products/pokemon-dark-explorers-booster-pack?variant=50398312759627",
    // Dark Explorers Booster Pack (Black & White) - Darkrai (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-dark-explorers-booster-pack?variant=57143646060875",
    "https://rogerz.dk/products/pokemon-dark-explorers-booster-pack?variant=50398312726859",
    // Dark Explorers Booster Pack (Black & White) - Venusaur (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-dark-explorers-booster-pack?variant=57143646028107",
    "https://rogerz.dk/products/pokemon-dark-explorers-booster-pack?variant=50398312661323",
    // Dark Explorers Booster Pack (Black & White) - Scrafty (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-dark-explorers-booster-pack?variant=50398312792395",
    // Dragons Exalted Booster Pack (Black & White) - Giratina (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-dragons-exalted-booster-pack?variant=57143645929803",
    "https://rogerz.dk/products/pokemon-dragons-exalted-booster-pack?variant=50397153919307",
    // Dragons Exalted Booster Pack (Black & White) - Rayquaza (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-dragons-exalted-booster-pack?variant=57143645897035",
    "https://rogerz.dk/products/pokemon-dragons-exalted-booster-pack?variant=50397153853771",
    // Dragons Exalted Booster Pack (Black & White) - Gyarados (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-dragons-exalted-booster-pack?variant=57143645864267",
    "https://rogerz.dk/products/pokemon-dragons-exalted-booster-pack?variant=50397153886539",
    // Dragons Exalted Booster Pack (Black & White) - Terrakion (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-dragons-exalted-booster-pack?variant=50397153952075",
    // Boundaries Crossed Booster Pack (Black & White) - White Kyurem (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-boundaries-crossed-booster-pack?variant=57143645634891",
    "https://rogerz.dk/products/pokemon-boundaries-crossed-booster-pack?variant=50396964684107",
    // Boundaries Crossed Booster Pack (Black & White) - Black Kyurem (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-boundaries-crossed-booster-pack?variant=57143645602123",
    "https://rogerz.dk/products/pokemon-boundaries-crossed-booster-pack?variant=50396964651339",
    // Boundaries Crossed Booster Pack (Black & White) - Landorus (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-boundaries-crossed-booster-pack?variant=57143645569355",
    "https://rogerz.dk/products/pokemon-boundaries-crossed-booster-pack?variant=50396964618571",
    // Boundaries Crossed Booster Pack (Black & White) - Keldeo (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-boundaries-crossed-booster-pack?variant=50396964716875",
    // Plasma Freeze Booster Pack (Black & White) - Bisharp (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-plasma-freeze-booster-pack?variant=57143645471051",
    "https://rogerz.dk/products/pokemon-plasma-freeze-booster-pack?variant=50396150759755",
    // Plasma Freeze Booster Pack (Black & White) - Deoxys (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-plasma-freeze-booster-pack?variant=57143645438283",
    "https://rogerz.dk/products/pokemon-plasma-freeze-booster-pack?variant=50396150726987",
    // Plasma Freeze Booster Pack (Black & White) - Absol (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-plasma-freeze-booster-pack?variant=57143645405515",
    "https://rogerz.dk/products/pokemon-plasma-freeze-booster-pack?variant=50396150694219",
    // Plasma Freeze Booster Pack (Black & White) - Thundurus (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-plasma-freeze-booster-pack?variant=50396150792523",
    // Legendary Treasures Booster Pack (Black & White) - Mewtwo (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-legendary-treasures-booster-pack?variant=57143645077835",
    "https://rogerz.dk/products/pokemon-legendary-treasures-booster-pack?variant=50395900805451",
    // Legendary Treasures Booster Pack (Black & White) - Reshiram (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-legendary-treasures-booster-pack?variant=57143645045067",
    "https://rogerz.dk/products/pokemon-legendary-treasures-booster-pack?variant=50395900772683",
    // Legendary Treasures Booster Pack (Black & White) - Zekrom (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-legendary-treasures-booster-pack?variant=57143645012299",
    "https://rogerz.dk/products/pokemon-legendary-treasures-booster-pack?variant=50395900739915",
    // Legendary Treasures Booster Pack (Black & White) - Genesect (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-legendary-treasures-booster-pack?variant=50395900838219",
    // Platinum Base Set Booster Pack - Giratina (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-platinum-base-set-booster-pack?variant=57143664968011",
    "https://rogerz.dk/products/pokemon-tcg-platinum-base-set-booster-pack?variant=51345684693323",
    // Platinum Base Set Booster Pack - Palkia (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-platinum-base-set-booster-pack?variant=57143664935243",
    "https://rogerz.dk/products/pokemon-tcg-platinum-base-set-booster-pack?variant=51345684660555",
    // Platinum Base Set Booster Pack - Dialga (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-platinum-base-set-booster-pack?variant=57143664902475",
    "https://rogerz.dk/products/pokemon-tcg-platinum-base-set-booster-pack?variant=51345684627787",
    // Platinum Base Set Booster Pack - Shaymin (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-platinum-base-set-booster-pack?variant=51345684726091",
    // Platinum Arceus Booster Pack - Arceus - grøn (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-platinum-arceus-booster-pack?variant=57143635607883",
    "https://rogerz.dk/products/pokemon-platinum-arceus-booster-pack?variant=47755536531787",
    // Platinum Arceus Booster Pack - Salamence (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-platinum-arceus-booster-pack?variant=57143635575115",
    "https://rogerz.dk/products/pokemon-platinum-arceus-booster-pack?variant=47755536433483",
    // Platinum Arceus Booster Pack - Zapdos (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-platinum-arceus-booster-pack?variant=57143635542347",
    "https://rogerz.dk/products/pokemon-platinum-arceus-booster-pack?variant=47755536466251",
    // Platinum Arceus Booster Pack - Arceus - blå (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-platinum-arceus-booster-pack?variant=47755536499019",
    // Team Rocket 1st Edition Booster Pack (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-team-rocket-1st-edition-booster-pack",
    // Pokémon XY: Hoopa EX Legendary Collection Box (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-xy-hoopa-ex-legendary-collection-box-5-pack-eng",
    // Base Set Booster Box - Unlimited (Wizards of the Coast) (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-box-unlimited",
    // Pokémon XY: GYM Vol. 4 Promo Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-xy-gym-vol-4-promo-booster-pack-1-kort-jp",
    // Prismatic Evolutions Lucario & Tyranitar EX Premium Collection (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-prismatic-evolutions-lucario-tyranitar-ex-premium-collection",
    // Prismatic Evolutions: Lucario ex & Tyranitar ex Premium Collection (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-prismatic-evolutions-lucario-ex-tyranitar-ex-premium-collection-box-14-pack-eng",
    // Special Haunted Edition 1-Pack Blister Crobat/Alolan Persian (Sun & Moon) - Alolan Persian / Brugtmo (raderad produkt)
    "https://rogerz.dk/products/pokemon-special-haunted-edition-1-pack-blister-crobat-alolan-persian?variant=57143654121803",
    // Special Haunted Edition 1-Pack Blister Crobat/Alolan Persian (Sun & Moon) - Crobat / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-special-haunted-edition-1-pack-blister-crobat-alolan-persian?variant=57143654089035",
    // Special Haunted Edition 1-Pack Blister Crobat/Alolan Persian (Sun & Moon) - Alolan Persian / Alm. mo (raderad produkt)
    "https://rogerz.dk/products/pokemon-special-haunted-edition-1-pack-blister-crobat-alolan-persian?variant=50902706454859",
    // Special Haunted Edition 1-Pack Blister Crobat/Alolan Persian (Sun & Moon) - Crobat / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-special-haunted-edition-1-pack-blister-crobat-alolan-persian?variant=50902706422091",
    // Legendary Beasts Collectors Pin 3-Pack Blister - Entei / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-legendary-beasts-collectors-pin-3-pack?variant=57143674962251",
    // Legendary Beasts Collectors Pin 3-Pack Blister - Raikou / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-legendary-beasts-collectors-pin-3-pack?variant=57143674929483",
    // Legendary Beasts Collectors Pin 3-Pack Blister - Suicune / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-legendary-beasts-collectors-pin-3-pack?variant=57143674896715",
    // Legendary Beasts Collectors Pin 3-Pack Blister - Entei / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-legendary-beasts-collectors-pin-3-pack?variant=51876754424139",
    // Legendary Beasts Collectors Pin 3-Pack Blister - Raikou / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-legendary-beasts-collectors-pin-3-pack?variant=51876632887627",
    // Legendary Beasts Collectors Pin 3-Pack Blister - Suicune / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-legendary-beasts-collectors-pin-3-pack?variant=51876632854859",
    // Sword & Shield Ultra-Premium Collection - Zacian & Zamazenta (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-sword-shield-ultra-premium-collection-zacian-zamazenta",
    // Pokemon GO Pokémon Center Elite Trainer Box (Sword & Shield) (raderad produkt)
    "https://rogerz.dk/products/pokemon-go-pokemon-center-etb",
    // Base Set Booster Pack - 1st Edition - Charizard / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-base-set-booster-pack-1st-edition?variant=57143673848139",
    // Base Set Booster Pack - 1st Edition - Blastoise / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-base-set-booster-pack-1st-edition?variant=57143673815371",
    // Base Set Booster Pack - 1st Edition - Venusaur / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-base-set-booster-pack-1st-edition?variant=57143673782603",
    // Base Set Booster Pack - 1st Edition - Charizard / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-base-set-booster-pack-1st-edition?variant=51787360108875",
    // Base Set Booster Pack - 1st Edition - Blastoise / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-base-set-booster-pack-1st-edition?variant=51787360076107",
    // Base Set Booster Pack - 1st Edition - Venusaur / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-base-set-booster-pack-1st-edition?variant=51787360043339",
    // WOTC 1999 Base Set Booster Pack - Charizard - Unlimited / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=57154563637579",
    // WOTC 1999 Base Set Booster Pack - Charizard - Unlimited / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=57154563604811",
    // WOTC 1999 Base Set Booster Pack - Venusaur - Unlimited / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=57154563572043",
    // WOTC 1999 Base Set Booster Pack - Venusaur - Unlimited / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=57154563539275",
    // WOTC 1999 Base Set Booster Pack - Blastoise - Unlimited / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=57154563506507",
    // WOTC 1999 Base Set Booster Pack - Blastoise - Unlimited / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=57154563473739",
    // WOTC 1999 Base Set Booster Pack - Blastoise (Shadowless) / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=57143650517323",
    // WOTC 1999 Base Set Booster Pack - Blastoise (Shadowless) / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=53126477447499",
    // WOTC 1999 Base Set Booster Pack - Charizard (UK Print 1999-00) / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=57143650386251",
    // WOTC 1999 Base Set Booster Pack - Charizard (UK Print 1999-00) / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=50976522174795",
    // WOTC 1999 Base Set Booster Pack - Blastoise (UK Print 1999-00) / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=57143650353483",
    // WOTC 1999 Base Set Booster Pack - Blastoise (UK Print 1999-00) / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=50976522142027",
    // WOTC 1999 Base Set Booster Pack - Venusaur (UK Print 1999-00) / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=57143650320715",
    // WOTC 1999 Base Set Booster Pack - Venusaur (UK Print 1999-00) / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-base-set-booster-pack-unlimited?variant=50464411386187",
    // Jungle Booster Pack - 1st Edition - Flareon / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-jungle-booster-pack-1st-edition?variant=57143635280203",
    // Jungle Booster Pack - 1st Edition - Scyther / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-jungle-booster-pack-1st-edition?variant=57143635247435",
    // Jungle Booster Pack - 1st Edition - Wigglytuff / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-jungle-booster-pack-1st-edition?variant=57143635214667",
    // Jungle Booster Pack - 1st Edition - Flareon / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-jungle-booster-pack-1st-edition?variant=50331110015307",
    // Jungle Booster Pack - 1st Edition - Scyther / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-jungle-booster-pack-1st-edition?variant=47751090176331",
    // Jungle Booster Pack - 1st Edition - Wigglytuff / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-jungle-booster-pack-1st-edition?variant=47751090143563",
    // Jungle Booster Pack - Unlimited - Flareon / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-jungle-booster-pack-unlimited?variant=57143634100555",
    // Jungle Booster Pack - Unlimited - Scyther / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-jungle-booster-pack-unlimited?variant=57143634067787",
    // Jungle Booster Pack - Unlimited - Wigglytuff / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-jungle-booster-pack-unlimited?variant=57143634035019",
    // Jungle Booster Pack - Unlimited - Flareon / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-jungle-booster-pack-unlimited?variant=50331076591947",
    // Jungle Booster Pack - Unlimited - Scyther / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-jungle-booster-pack-unlimited?variant=50331076559179",
    // Jungle Booster Pack - Unlimited - Wigglytuff / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-jungle-booster-pack-unlimited?variant=47723174920523",
    // Fossil Booster Pack - 1st Edition - Aerodactyl / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-fossil-booster-pack-1st-edition?variant=57143634231627",
    // Fossil Booster Pack - 1st Edition - Lapras / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-fossil-booster-pack-1st-edition?variant=57143634198859",
    // Fossil Booster Pack - 1st Edition - Zapdos / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-fossil-booster-pack-1st-edition?variant=57143634166091",
    // Fossil Booster Pack - 1st Edition - Aerodactyl / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-fossil-booster-pack-1st-edition?variant=50330895679819",
    // Fossil Booster Pack - 1st Edition - Lapras / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-fossil-booster-pack-1st-edition?variant=50464309444939",
    // Fossil Booster Pack - 1st Edition - Zapdos / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-fossil-booster-pack-1st-edition?variant=47723211489611",
    // Fossil Booster Pack - Unlimited - Zapdos / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/fossil-booster-pack-unlimited?variant=57143622336843",
    // Fossil Booster Pack - Unlimited - Lapras / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/fossil-booster-pack-unlimited?variant=57143622304075",
    // Fossil Booster Pack - Unlimited - Aerodactyl / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/fossil-booster-pack-unlimited?variant=57143622238539",
    // Fossil Booster Pack - Unlimited - Zapdos / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/fossil-booster-pack-unlimited?variant=50330912686411",
    // Fossil Booster Pack - Unlimited - Lapras / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/fossil-booster-pack-unlimited?variant=47723206345035",
    // Fossil Booster Pack - Unlimited - Aerodactyl / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/fossil-booster-pack-unlimited?variant=47723208966475",
    // ── Ägarens katalogbeslut 2026-08-13 (apply-owner-decisions.ts) ──
    // Pokémon Mega Evolution: Mega Evolution Checklane Blister 1-Pack Blisters (Drifblim) (ENG) (offer krockar med målets)
    "https://aquitaz.se/products/pokemon-mega-evolution-mega-evolution-1-pack-blisters-drifblim-eng",
    // Pokemon Scarlet & Violet 4.5 - Paldean Fates Tin Charizard (offer krockar med målets)
    "https://speltrollet.se/products/copy-of-pokemon-scarlet-violet-4-5-paldean-fates-mini-tin-display-1",
    // Pokemon ME02 Phantasmal Flames Elite Trainer - Speltrollet Collector Edition (offer krockar med målets)
    "https://speltrollet.se/products/pokemon-me02-phantasmal-flames-elite-trainer-speltrollet-collector-edition",
    // Call of Legends Booster Pack - Deoxys / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-call-of-legends-booster-pack?variant=50438632702283",
    // Pokémon: Classic Collection Box (Japansk) (raderad produkt)
    "https://kantovault.se/products/pokemon-classic-collection-box-japansk",
    "https://tcgstore.se/products/pokemon-japansk-classic-collection",
    // Pokemon GO Premium Collection Dragonite V Star (raderad produkt)
    "https://speltrollet.se/products/pokemon-go-premium-collection-dragonite-v-star",
    // Black Sparkle Booster (raderad produkt)
    "https://aquitaz.se/products/pokemon-sword-shield-jet-black-geist-booster-pack",
    // Pokemon Mega Evolution: Pitch Black Half Booster Display (ENG) (raderad produkt)
    "https://beamcardshop.com/products/pitch-black-premium-checklane-display",
    "https://aquitaz.se/products/pokemon-mega-evolution-pitch-black-half-booster-display-18-pack-eng",
    // Pokémon Mega Evolution: Mega Evolution Half Booster Display (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-mega-evolution-half-booster-display-18-pack-eng",
    // Pokémon Scarlet & Violet: Surging Sparks Half-Size Booster Display (raderad produkt)
    "https://rogerz.dk/products/pokemon-surging-sparks-half-size-booster-box",
    "https://aquitaz.se/products/pokemon-scarlet-violet-surging-sparks-half-size-booster-display",
    // Pokémon Scarlet & Violet Half Booster Display (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-half-booster-display-18-pack-eng",
    // Pokémon Mega Evolution: Perfect Order Mega Zygarde ex Premium Collection Box (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-mega-evolution-perfect-order-mega-zygarde-ex-premium-collection-box-8-pack-eng",
    // Pokémon Scarlet & Violet: Holiday Calendar 2025 Collection Box (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-holiday-calendar-2025-collection-box-6-pack-eng",
    "https://tcgstore.se/products/pokemon-tcg-holiday-calendar-adventskalender-2025",
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-holiday-calendar-2025.html",
    "https://hobbykort.se/products/pokemon-tcg-holiday-calendar-2025",
    "https://dragonslair.se/products/pokemon-tcg-holiday-calendar-2025-pokemon",
    "https://speltrollet.se/products/pokemon-tcg-adventskalender-holiday-calendar-2025",
    // Pokémon Sword & Shield: Team Instinct Special Collection Box (ENG) (raderad produkt)
    "https://dragonslair.se/products/pokemon-tcg-pokemon-go-special-team-collection-team-instinct-pokemon",
    "https://aquitaz.se/products/pokemon-sword-and-shield-team-instinct-special-collection-box-6-pack-eng",
    "https://beamcardshop.com/products/pokemon-go-special-collection-team-instinct",
    // Pokémon Sword & Shield: Team Mystic Special Collection Box (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sword-and-shield-team-mystic-special-collection-box-6-pack-eng",
    "https://dragonslair.se/products/pokemon-tcg-pokemon-go-special-team-collection-team-mystic-pokemon",
    "https://beamcardshop.com/products/pokemon-go-special-collection-team-mystic",
    // Pokémon: Paldea Adventure Chest Collection Box (ENG) (raderad produkt)
    "https://speltrollet.se/products/pok85608",
    "https://aquitaz.se/products/pokemon-paldea-adventure-chest-collection-box-6-pack-eng",
    "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-paldea-adventure-chest.html",
    "https://dragonslair.se/products/pokemon-tcg-paldea-adventure-chest-pokemon",
    "https://tcgstore.se/products/pokemon-tcg-paldea-adventure-chest",
    "https://www.shinycards.se/pokemon/collection-box/pokemon-tcg-paldea-adventure-chest",
    // Pokémon Scarlet & Violet: Stellar Crown (Terapagos ex) Ultra Premium Collection (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-stellar-crown-terapagos-ex-ultra-premium-collection",
    // Pokemon Crown Zenith Tin (raderad produkt)
    "https://speltrollet.se/products/pokemon-crown-zenith-tin",
    // Pokémon Sword & Shield: Team Valor Special Collection Box (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sword-and-shield-team-valor-special-collection-box-6-pack-eng",
    "https://dragonslair.se/products/pokemon-tcg-pokemon-go-special-team-collection-team-valor-pokemon",
    "https://beamcardshop.com/products/pokemon-go-special-collection-team-valor",
    // Pokémon: BREAK Evolution Featuring Ho-Oh and Lugia Collection Box (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-break-evolution-featuring-ho-oh-and-lugia-collection-box-5-pack-eng",
    // Pokémon Sun & Moon: Ultra Beasts GX Premium Collection Box (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sun-moon-ultra-beasts-gx-premium-collection-box-8-pack-eng",
    // Pokémon Mega Evolution: Enhanced 2-Pack Blister (Gengar, Marshadow & Team Rocket's Mimikyu) (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-mega-evolution-enhanced-2-pack-blister-gengar-marshadow-team-rockets-mimikyu-eng",
    // Pokémon Sun & Moon Base Set Sleeved Booster Pack (raderad produkt)
    "https://beamcardshop.com/products/sun-moon-base-sleeved-booster",
    // Neo Discovery Booster Pack - 1st Edition (Neo) - Xatu / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-neo-discovery-booster-pack-1st-edition?variant=57143650025803",
    // Neo Discovery Booster Pack - 1st Edition (Neo) - Umbreon / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-neo-discovery-booster-pack-1st-edition?variant=57143649993035",
    // Neo Discovery Booster Pack - 1st Edition (Neo) - Scizor / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-neo-discovery-booster-pack-1st-edition?variant=57143649960267",
    // Neo Discovery Booster Pack - 1st Edition (Neo) - Smeargle / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-neo-discovery-booster-pack-1st-edition?variant=57143649927499",
    // Neo Discovery Booster Pack - 1st Edition (Neo) - Xatu / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-neo-discovery-booster-pack-1st-edition?variant=50461360390475",
    // Neo Discovery Booster Pack - 1st Edition (Neo) - Umbreon / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-neo-discovery-booster-pack-1st-edition?variant=50461360357707",
    // Neo Discovery Booster Pack - 1st Edition (Neo) - Scizor / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-neo-discovery-booster-pack-1st-edition?variant=50461360324939",
    // Neo Discovery Booster Pack - 1st Edition (Neo) - Smeargle / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-neo-discovery-booster-pack-1st-edition?variant=50461335093579",
    // Flashfire Sleeved Booster Pack (X & Y) - Mega Charizard Y / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-flashfire-sleeved-booster-pack?variant=57143653859659",
    // Flashfire Sleeved Booster Pack (X & Y) - Mega Charizard X / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-flashfire-sleeved-booster-pack?variant=57143653826891",
    // Flashfire Sleeved Booster Pack (X & Y) - Mega Pyroar / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-flashfire-sleeved-booster-pack?variant=57143653794123",
    // Flashfire Sleeved Booster Pack (X & Y) - Mega Kangaskhan / Brugtmoms (raderad produkt)
    "https://rogerz.dk/products/pokemon-flashfire-sleeved-booster-pack?variant=57143653761355",
    // Flashfire Sleeved Booster Pack (X & Y) - Mega Charizard Y / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-flashfire-sleeved-booster-pack?variant=56682983424331",
    // Flashfire Sleeved Booster Pack (X & Y) - Mega Charizard X / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-flashfire-sleeved-booster-pack?variant=56682983391563",
    // Flashfire Sleeved Booster Pack (X & Y) - Mega Pyroar / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-flashfire-sleeved-booster-pack?variant=56682983358795",
    // Flashfire Sleeved Booster Pack (X & Y) - Mega Kangaskhan / Alm. moms (raderad produkt)
    "https://rogerz.dk/products/pokemon-flashfire-sleeved-booster-pack?variant=56682983326027",
    // Team Up Sleeved Booster Pack (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-team-up-sleeved-booster-pack",
    // Neo Discovery Booster Pack (Japansk) (raderad produkt)
    "https://rogerz.dk/products/pokemon-neo-discovery-booster-pack-japansk",
    // GX Ultra Shiny Booster Box (Sun & Moon) (raderad produkt)
    "https://rogerz.dk/products/gx-ultra-shiny-booster-box",
    // Pokémon GO Booster Box - Japansk (Sword & Shield) (raderad produkt)
    "https://rogerz.dk/products/pokemon-go-booster-box",
    "https://nordictcg.se/55-pokémon-go-booster-box.html",
    // Pokemon Sword & Shield: Pokemon Go Booster Box Display (Japansk) (raderad produkt)
    "https://speltrollet.se/products/pokemon-sword-shield-pokemon-go-booster-box-display-japansk",
    // Mega Evolution ID/TH Booster Box (raderad produkt)
    "https://rogerz.dk/products/pokemon-tcg-ninja-spinner-booster-box-japansk-mega-evolution",
    // Pokémon Mega: Premium Trainer Collection Box (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-mega-premium-trainer-collection-box-20-pack-jp",
    // Mega Powers Collection (raderad produkt)
    "https://aquitaz.se/products/pokemon-mega-mega-brave-pokemon-center-collection-box-60-pack-jp",
    // Pokémon Sun & Moon: Umbreon GX Premium Collection Box (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sun-moon-umbreon-gx-premium-collection-box-6-pack-eng",
    // ── Ägarens katalogbeslut 2026-08-13 (apply-owner-decisions.ts) ──
    // Pokémon MEGA: MEGA Card GYM Vol. 1 Promo Booster Pack (JP) (offer krockar med målets)
    "https://aquitaz.se/products/pokemon-mega-mega-card-gym-vol-1-promo-booster-pack-1-kort-jp",
    // Pokémon Base Set Vintage Booster Pack (ENG) (offer krockar med målets)
    "https://aquitaz.se/products/pokemon-base-set-vintage-booster-pack-blastoise-artwork-11-kort-eng",
    "https://aquitaz.se/products/pokemon-base-set-vintage-booster-pack-charizard-artwork-11-kort-eng",
    // ── Ägarens katalogbeslut 2026-08-13 (apply-owner-decisions.ts) ──
    // EX Deoxys Booster Pack - Rayquaza (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-ex-deoxys-booster-pack?variant=56387847225675",
    // EX Deoxys Booster Pack - Deoxys - (Gul) (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-ex-deoxys-booster-pack?variant=56387847258443",
    // EX Deoxys Booster Pack - Deoxys (Blå) (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-ex-deoxys-booster-pack?variant=56387847323979",
    // Base Set 2 Booster Pack - Unlimited - Mewtwo artwork (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-base-set-2-booster-pack-unlimited?variant=50330772767051",
    // Base Set 2 Booster Pack - Unlimited - Raichu artwork (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-base-set-2-booster-pack-unlimited?variant=50330772799819",
    // Base Set 2 Booster Pack - Unlimited - Pidgeot artwork (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-base-set-2-booster-pack-unlimited?variant=46912861831499",
    // Pokémon Base Set Vintage Booster Pack (ENG) (offer krockar med målets)
    "https://aquitaz.se/products/pokemon-base-set-vintage-booster-pack-venusaur-artwork-11-kort-eng",
    // Pokémon Mega Evolution: Mega Evolution Pokémon Center Elite Trainer Box (Mega Lucario) (ETB) (offer krockar med målets)
    "https://aquitaz.se/products/pokemon-mega-evolution-mega-evolution-pokemon-center-elite-trainer-box-mega-lucario-etb-11-pack",
    // Pokémon: Prismatic Bundle Display (raderad produkt)
    "https://pokexclusive.se/products/pokemon-prismatic-bundle-display",
    // Sword Booster Box (raderad produkt)
    "https://aquitaz.se/products/pokemon-sword-shield-pokemon-go-booster-box",
    // Pokémon Sun & Moon: Dragon Storm SM6a Booster Box (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sun-moon-dragon-storm-sm6a-booster-box-30-pack-jp",
    // Pokémon Sun & Moon: Night Unison SM9a Booster Box (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sun-moon-night-unison-sm9a-booster-box-5-kort-jp",
    // Mega Mewtwo X Collection (raderad produkt)
    "https://tinymisters.com/products/pokemon-mega-mega-brave-pokemon-center-collection-box-60-pack-jp",
    // Pokémon MEGA: Mega Symphonia Pokémon Center Collection Box (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-mega-mega-symphonia-pokemon-center-collection-box-60-pack-jp",
    "https://tinymisters.com/products/pokemon-mega-mega-symphonia-pokemon-center-collection-box-60-pack-jp",
    "https://speltrollet.se/products/pokemon-mega-symphonia-pokemon-center-set-japansk",
    "https://nordictcg.se/57-mega-symphonia-pokémon-center-special-box.html",
    // Pokémon TCG Illustration Contest 2024 Promo Card Pack (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-illustration-contest-2024-promo-card-booster-pack-jp",
    // Pokémon: 5th Edition Gym Promo Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sword-shield-5th-edition-gym-promo-booster-pack-7-kort-jp",
    // Pokémon Scarlet & Violet: GYM Vol. 7 Promo Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-xy-gym-vol-7-promo-booster-pack-1-kort-jp",
    // Pokémon McDonalds Happy Meal 2023 Match Battle (Klawf) Booster Pack (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-mcdonalds-happy-meal-2023-match-battle-klawf-booster-pack",
    // Pokémon McDonalds Happy Meal 2023 Match Battle (Fuecoco B) Booster Pack (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-mcdonalds-happy-meal-2023-match-battle-fuecoco-b-booster-pack",
    // Pokémon XY: GYM Vol. 3 Promo Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-xy-gym-vol-3-promo-booster-pack-1-kort-jp",
    // Pokémon XY: GYM Vol. 5 Promo Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-xy-gym-vol-5-promo-booster-pack-1-kort-jp",
    // Pokémon Card Gym Promo MEGA Vol. 4 Booster (1 Card) (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-gym-vol-4-promo-booster-pack-1-kort-jp",
    // Pokémon Scarlet & Violet: GYM Vol. 8 Promo Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-gym-vol-8-promo-booster-pack-1-kort-jp",
    // Pokémon Scarlet & Violet: Journey Together SV9 (Scraggy & Yanma) Checklane Blister Pack (ENG) (Bundl (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-journey-together-sv9-scraggy-yanma-checklane-blister-pack-eng-bundle-of-2",
    // Pokémon Scarlet & Violet: Journey Together SV9 (Yanmega & Scrafty) 3-Pack Blister (Bundle of 2) (ENG (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-journey-together-sv9-yanmega-scrafty-3-pack-blister-bundle-of-2-eng",
    // Pokémon Sword & Shield: Evolving Skies & Chilling Reign 2-Pack Pin Blister (Latias) (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sword-shield-evolving-skies-chilling-reign-2-pack-pin-blister-latias-eng",
    // Pokémon Sword & Shield: Evolving Skies & Chilling Reign 2-Pack Pin Blister (Latios) (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sword-shield-evolving-skies-chilling-reign-2-pack-pin-blister-latios-eng",
    // Mega Gengar Pin 2-Pack Blister (raderad produkt)
    "https://aquitaz.se/products/pokemon-mega-raikou-2-pack-blister-eng",
    // Pokémon Sun & Moon: Meganium, Typhlosion & Feraligatr 2-Pack Blisters (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-meganium-typhlosion-feraligatr-2-pack-blisters-eng",
    // Pokémon Diamond & Pearl: Platinum Supreme Victors Booster Pack (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-platinum-supreme-victors-booster-pack-10-kort-eng",
    // Pokémon MEGA: MEGA Card GYM Vol. 1 Promo Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-mega-mega-card-gym-vol-1-promo-booster-pack-2-kort-jp",
    // Pokémon: First Partner Grookey, Scorbunny & Sobble Booster Pack (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-first-partner-grookey-scorbunny-sobble-booster-pack-3-kort-2-boosters-eng",
    // Pokémon: First Partner Bulbasaur, Charmander & Squirtle Booster Pack (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-first-partner-bulbasaur-charmander-squirtle-booster-pack-3-kort-eng",
    "https://dragonslair.se/products/pokemon-tcg-my-first-battle-charmander-squirtle",
    "https://tcgstore.se/products/pokemon-tcg-my-first-battle-charmander-vs-squirtle",
    "https://www.maxgaming.se/sv/pokemon/tcg-my-first-battle-charmander-squirtle",
    // Pokemon: First Partner Series 1 Booster Pack (ENG) (raderad produkt)
    "https://aquitaz.se/products/pokemon-first-partner-series-1-booster-pack-3-kort-eng",
    // Pokemon MEGA: MEGA Card GYM Vol. 5 Promo Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-mega-mega-card-gym-vol-5-promo-booster-pack-1-card-jp",
    // YU NAGABA × Pokémon Card Game Eeveelution Promo Pack (raderad produkt)
    "https://aquitaz.se/products/pokemon-yu-nagaba-eevees-special-promo-booster-pack",
    // Pokémon Card Summer Is Here! Promo Card Get Campaign! Promo Card Pack (raderad produkt)
    "https://aquitaz.se/products/pokemon-summer-is-here-2024-promo-booster-pack",
    // Pokémon XY: GYM Vol. 6 Promo Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-xy-gym-vol-6-promo-booster-pack-1-kort-jp",
    // Pokémon Scarlet & Violet: GYM Vol. 9 Promo Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-gym-vol-9-promo-booster-pack-1-kort-jp",
    // Pokémon Scarlet & Violet: Event Trainer Organizer Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-event-trainer-organizer-booster-pack-1-kort-jp",
    // Pokémon Scarlet & Violet: Extra Battle Day Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-extra-battle-day-booster-pack-1-kort-jp",
    // McDonald's 2014 Promo Booster (raderad produkt)
    "https://aquitaz.se/products/pokemon-xy-macdonalds-promo-booster-pack-1-kort-jp",
    // Pokémon Card Gym Promo MEGA Vol. 2 Booster (1 Card) (raderad produkt)
    "https://aquitaz.se/products/pokemon-scarlet-violet-gym-vol-2-promo-booster-pack-7-kort-jp",
    // Pokémon Scarlet & Violet: GYM Vol. 10 Promo Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-xy-gym-vol-10-promo-booster-pack-1-kort-jp",
    // ── Ägarens katalogbeslut 2026-08-13 (apply-owner-decisions.ts) ──
    // Pokémon Sword & Shield: s1H Shield Expansion Booster Pack (JP) (raderad produkt)
    "https://aquitaz.se/products/pokemon-sword-shield-shield-expansion-booster-pack-5-kort-jp",
  ].map(normalizeListingUrl)
);

/**
 * URL:er nekade FRÅN ADMIN (tabellen `DeniedListingUrl`), speglade i minnet.
 *
 * ⛔ MODULEN FÅR INTE RÖRA DATABASEN SJÄLV. Den importeras av skrapare, skript och
 *    tester som inte alla har en anslutning, och `isDeniedListingUrl` anropas EN GÅNG
 *    PER ANNONS i loopar med tusentals varv — ett uppslag där hade blivit tusentals
 *    frågor per körning. (Samma lärdom som restock-lanens källcache 2026-07-07: ett
 *    DB-uppslag per körning höll Neons compute vaken dygnet runt.) Anroparen hämtar
 *    raderna EN gång och matar in dem här; funktionen förblir synkron.
 */
const DYNAMIC = new Set<string>();

/**
 * Fyller den dynamiska listan. Anropas en gång per skrapkörning av runner.ts, där
 * databasen ändå är vaken. URL:erna normaliseras här, så anroparen kan skicka råa.
 */
export function setDynamicDenylist(urls: readonly string[]): void {
  DYNAMIC.clear();
  for (const u of urls) DYNAMIC.add(normalizeListingUrl(u));
}

/** Antal dynamiska poster — för loggning och för att kunna se att laddningen skett. */
export function dynamicDenylistSize(): number {
  return DYNAMIC.size;
}

/**
 * SANT om URL:en är nekad → auto-importen ska ALDRIG skapa en produkt för den.
 *
 * Två källor: den KODGRANSKADE listan ovan (historik, ändras via PR) och admins
 * borttagningar (`DeniedListingUrl`). Den statiska listan gäller alltid; den
 * dynamiska bara efter `setDynamicDenylist` — se varningen där.
 */
export function isDeniedListingUrl(url: string): boolean {
  const n = normalizeListingUrl(url);
  return DENIED.has(n) || DYNAMIC.has(n);
}
