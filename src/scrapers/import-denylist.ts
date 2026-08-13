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

/** Normaliserar en URL för jämförelse: gemener, utan query/hash, utan avslutande slash. */
function normUrl(u: string): string {
  return u.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
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
    "https://www.tradera.com/item/1001339/721590995/pok%C3%A9mon-glory-of-team-rocket-booster-pack-jp-sv10-",
    // Inferno X Booster Pack Japansk (offer krockar med målets)
    "https://www.tradera.com/item/1001339/720305768/pok%C3%A9mon-inferno-x-booster-pack-japansk-m2-",
    // Pokémon WOTC: Neo Genesis Booster Pack - Feraligatr (offer krockar med målets)
    "https://www.poketalk.se/products/pokemon-wotc-neo-genesis-booster-pack?variant=52365478461782",
    // Pokémon WOTC: Neo Genesis Booster Pack - Meganium (offer krockar med målets)
    "https://www.poketalk.se/products/pokemon-wotc-neo-genesis-booster-pack?variant=52365478429014",
    // Pokémon WOTC: Neo Genesis Booster Pack - Lugia (offer krockar med målets)
    "https://www.poketalk.se/products/pokemon-wotc-neo-genesis-booster-pack?variant=52365478396246",
    // Pokémon Mega: Nihil Zero (M3) Booster – JAPANSK (offer krockar med målets)
    "https://cardgame.se/engelska-pokmon-produkter/japansktkinesiskt/booster-boxar/nihil-zero-japansk",
    "https://www.tradera.com/item/1001339/721530411/pok%C3%A9mon-mega-nihil-zero-booster-pack-jp-",
    // [JP] Pokémon BOOSTERPACK - Cyber Judge (SV5M) (offer krockar med målets)
    "https://www.tradera.com/item/1001339/720305769/pok%C3%A9mon-cyber-judge-booster-pack-jp-sv5m-",
    // [JP] Pokémon BOOSTERPACK - Stellar Miracle (SV7) (offer krockar med målets)
    "https://www.tradera.com/item/1001339/727090510/pok%C3%A9mon-stellar-miracle-sv7-booster-pack-5-kort-jp-",
    // Pokémon Scarlet & Violet: Stellar Miracle Booster Pack (JP) (offer krockar med målets)
    "https://www.tradera.com/item/1001339/727090510/pok%C3%A9mon-stellar-miracle-sv7-booster-pack-5-kort-jp-",
    // [JP] Pokémon BOOSTERPACK - Battle Partners (SV9) (offer krockar med målets)
    "https://www.tradera.com/item/1001339/673967025/pok%C3%A9mon-battle-partners-booster-pack-japanskt-",
    // Pokémon Scarlet & Violet: Battle Partners Booster Pack (JP) (offer krockar med målets)
    "https://www.tradera.com/item/1001339/704224957/pok%C3%A9mon-scarlet-violet-battle-partners-booster-pack-japanskt-sv9-",
    // [JP] Pokémon BOOSTERPACK - Mega Brave (M1L) (offer krockar med målets)
    "https://www.tradera.com/item/1001339/689761145/pokemon-mega-brave-booster-pack-1-jp-m1l-",
    // [JP] Pokémon BOOSTERPACK - Mega Symphonia (M1S) (offer krockar med målets)
    "https://www.tradera.com/item/1001339/744340934/pokemon-mega-mega-symphonia-booster-pack-m1s-japanska",
    // Paldea Evolved 1-Pack Checklane Booster Pack - Smoliv / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-paldea-evolved-1-pack-checklane-booster-pack?variant=51778464252235",
    // Paldea Evolved 1-Pack Checklane Booster Pack - Growlithe / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-tcg-paldea-evolved-1-pack-checklane-booster-pack?variant=51778464219467",
    // Dark Explorers Booster Pack (Black & White) - Darkrai / Brugtmoms (offer krockar med målets)
    "https://www.tradera.com/item/1001339/741530740/booster-paket-1-st-pokemon-b-w-dark-explorers-darkrai-nytt",
    // Boundaries Crossed Booster Pack (Black & White) - Black Kyurem / Brugtmoms (offer krockar med målets)
    "https://www.tradera.com/item/1001339/741529864/booster-paket-1-st-pokemon-b-w-boundaries-crossed-black-kyurem-nytt",
    // Boundaries Crossed Booster Pack (Black & White) - Landorus / Brugtmoms (offer krockar med målets)
    "https://www.tradera.com/item/1001339/741529759/booster-paket-1-st-pokemon-b-w-boundaries-crossed-landorus-nytt",
    // Plasma Freeze Booster Pack (Black & White) - Thundurus / Brugtmoms (offer krockar med målets)
    "https://www.tradera.com/item/1001339/741530031/booster-paket-1-st-pokemon-b-w-plasma-freeze-thundurus-nytt",
    // Plasma Freeze Booster Pack (Black & White) - Bisharp / Brugtmoms (offer krockar med målets)
    "https://www.tradera.com/item/1001339/741530231/booster-paket-1-st-pokemon-b-w-plasma-freeze-bisharp-nytt",
    // Plasma Freeze Booster Pack (Black & White) - Deoxys / Brugtmoms (offer krockar med målets)
    "https://www.tradera.com/item/1001339/741530034/booster-paket-1-st-pokemon-b-w-plasma-freeze-deoxys-nytt",
    // Plasma Freeze Booster Pack (Black & White) - Absol / Brugtmoms (offer krockar med målets)
    "https://www.tradera.com/item/1001339/741530133/booster-paket-1-st-pokemon-b-w-plasma-freeze-absol-nytt",
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
    "https://www.cardmarket.com/en/Pokemon/Products?idProduct=551776&language=7",
    // Tidal Storm Booster Box (offer krockar med målets)
    "https://www.cardmarket.com/en/Pokemon/Products?idProduct=552239&language=7",
    // Space Juggler Booster Box (s10P)(Japansk) (offer krockar med målets)
    "https://www.tradera.com/item/1001340/737534925/pokemon-space-juggler-s10p-booster-box-japanese",
    // Shiny Star V Limited Booster Box Set (offer krockar med målets)
    "https://www.cardmarket.com/en/Pokemon/Products?idProduct=522555&language=7",
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
    "https://www.tradera.com/item/1001341/740329962/prismatic-evolutions-pok%C3%A9mon-center-elite-trainer-box",
    // Ascended Heroes Pokémon Center Elite Trainer Box (offer krockar med målets)
    "https://www.tradera.com/item/1001341/744751379/ascended-heroes-pokemon-center-etb",
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
    "https://www.tradera.com/item/1001341/738765124/pok%C3%A9mon-tcg-greninja-ex-ultra-premium-collection",
    // Scarlet & Violet - 151 Ultra-Premium Collection (Scarlet & Violet 3.5) (offer krockar med målets)
    "https://www.tradera.com/item/1001341/745001135/pok%C3%A9mon-scarlet-violet-151-ultra-premium-collection-upc-",
    // Pokémon Sword & Shield Charizard Ultra-Premium Collection (offer krockar med målets)
    "https://www.tradera.com/item/1001341/744510562/pok%C3%A9mon-sword-shield-ultra-premium-collection-charizard",
    // Pokémon Sword & Shield: Celebrations Ultra-Premium Collection (ENG) (offer krockar med målets)
    "https://www.tradera.com/item/1001341/742557228/pok%C3%A9mon-celebrations-25th-anniversary-ultra-premium-collection-eng",
    // Greninja/Kingdra ex Special Illustration Collection Box (Scarlet & Violet) - Greninja / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-greninja-kingdra-ex-special-illustration-collection?variant=49902071120203",
    // Greninja/Kingdra ex Special Illustration Collection Box (Scarlet & Violet) - Kingdra / Alm. moms (offer krockar med målets)
    "https://rogerz.dk/products/pokemon-greninja-kingdra-ex-special-illustration-collection?variant=49902071152971",
    // Abyss Eye Booster Box - Japansk (Mega Evolution) (offer krockar med målets)
    "https://www.tradera.com/item/1001340/742378871/pok%C3%A9mon-mega-abyss-eye-booster-box-japansk-",
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
    "https://www.cardmarket.com/en/Pokemon/Products?idProduct=754822&language=7",
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
  ].map(normUrl)
);

/** SANT om URL:en är nekad → auto-importen ska ALDRIG skapa en produkt för den. */
export function isDeniedListingUrl(url: string): boolean {
  return DENIED.has(normUrl(url));
}
