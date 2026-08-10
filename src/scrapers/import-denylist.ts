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
  ].map(normUrl)
);

/** SANT om URL:en är nekad → auto-importen ska ALDRIG skapa en produkt för den. */
export function isDeniedListingUrl(url: string): boolean {
  return DENIED.has(normUrl(url));
}
