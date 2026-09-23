/**
 * /guider — Foilios egna set-guider och köpguider (ägarbeslut 2026-09-23).
 *
 * VARFÖR EN EGEN YTA OCH INTE /nyheter: nyheterna är appens flöde (kort livslängd,
 * godkänns i admin, dolt bakom en spak). En guide är tvärtom EVERGREEN — den ska
 * rankas på "delta reign släppdatum" i månader och länka in i katalogen. Den är
 * den första interna länken till ett set från en sida med riktig brödtext.
 *
 * ⛔ INNEHÅLLET BOR I KODEN, INTE I DATABASEN ELLER PÅ VOLYMEN. Guiderna ändras
 *    ett par gånger i månaden, och en incheckad fil ger helstatiska sidor som
 *    prerenderas vid bygget: noll Neon-väckningar, noll volym, och versionshistorik
 *    på varje mening. En ny guide = en ny post här + push.
 * ⛔ BARA VERIFIERADE FAKTA (CLAUDE.md "Regler"). Släppdatum, innehåll per produkt
 *    och kortantal tas ur Pokémons officiella sidor eller vår egen katalog, och
 *    källan står under `sources`. Vet vi inte — skriv det inte. Aldrig ett gissat
 *    antal boosters, aldrig en påhittad promo.
 * ⛔ INGA PRISER I TEXTEN. Sidan är statisk och ett pris i brödtext är fel dagen
 *    efter. Vi pekar på produkt-/setsidan, där priset är levande.
 * ⛔ `links`-blockens `href` är INTERNA vägar utan språkprefix. Produkt-slugs är
 *    avlästa ur katalogen 2026-09-23; byter en produkt slug blir länken en mjuk 404
 *    (samma sida som alla döda slugs) — uppdatera här.
 * ⛔ Nämn aldrig konkurrenter eller inspirationssajter (CLAUDE.md, första stycket).
 *
 * Texten är svensk på båda språken — sajten är svensk och guiderna skrivs för
 * svenska sökningar. `/en/guider/*` pekar därför sin kanoniska URL på svenska.
 */

export type GuideBlock =
  | { type: "h"; text: string }
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "links"; items: { href: string; label: string; note?: string }[] }
  /**
   * En markerad ruta. `rumor` = OBEKRÄFTAT (läckor, butikslistningar, varumärkes-
   * registreringar): står alltid i en egen gul ruta, aldrig i löptexten — läsaren ska
   * aldrig kunna ta en läcka för ett besked från Pokémon.
   */
  | { type: "note"; tone: "rumor" | "info"; title: string; text: string };

export interface Guide {
  slug: string;
  /** Sidans h1 och <title>. Bär sökordet först. */
  title: string;
  /** Meta-beskrivning + ingress i listan, ~150 tecken. */
  description: string;
  kind: "set" | "guide" | "calendar";
  /** ISO-datum (YYYY-MM-DD). */
  publishedAt: string;
  updatedAt: string;
  /** Katalogens `CardSet.id` — ger länken "Se setet" och guidelänken på setsidan. */
  setId?: string;
  intro: string;
  /** Snabbfakta överst. Varje rad ska gå att belägga i `sources` eller katalogen. */
  facts?: { label: string; value: string }[];
  body: GuideBlock[];
  sources: { label: string; url: string }[];
}

export const GUIDES: Guide[] = [
  {
    slug: "delta-reign",
    title: "Pokémon Delta Reign: släppdatum, produkter och vad setet innehåller",
    description:
      "Delta Reign släpps 6 november 2026 med Mega Rayquaza ex i spetsen. Här är allt om setet, produkterna och hur du bevakar dem i svenska butiker.",
    kind: "set",
    publishedAt: "2026-09-23",
    updatedAt: "2026-09-23",
    setId: "cmtnj78kh0000ecn60yv8dti6",
    intro:
      "Nästa set i Mega Evolution-serien heter Delta Reign, och den här gången är det Mega Rayquaza ex som står i centrum. Det är första gången på över tio år som Mega Rayquaza är tillbaka i kortspelet. Här samlar vi det som är bekräftat om setet och vilka produkter som kommer.",
    facts: [
      { label: "Släppdatum", value: "6 november 2026 (samtidigt över hela världen)" },
      { label: "Serie", value: "Mega Evolution" },
      { label: "Antal kort", value: "Över 135" },
      { label: "Huvudkort", value: "Mega Rayquaza ex, Mega Golurk ex, Mega Malamar ex, Mega Golisopod ex" },
      { label: "Japansk motsvarighet", value: "Storm Emeralda (Japan 31 juli 2026) + japanska ex Starter Sets" },
    ],
    body: [
      { type: "h", text: "Vad är nytt i Delta Reign?" },
      {
        type: "p",
        text: "Setet har över 135 kort, varav fler än 20 Trainer-kort och fler än 35 kort med specialillustrationer. Förutom Mega Rayquaza ex är Mega Golurk ex, Mega Malamar ex och Mega Golisopod ex setets stora Mega-kort.",
      },
      {
        type: "p",
        text: "Den stora spelnyheten är Legendary Stadium: arenakort som spelas i par och tillsammans bildar en gemensam illustration. Vissa kort bygger vidare på dem. Groudon gör till exempel betydligt mer skada när en Legendary-arena ligger i spel.",
      },
      {
        type: "p",
        text: "Andra kort som redan visats är Heat Rotom ex, Kommo-o, Delibird och Supportern Zinnia's Trust.",
      },
      { type: "h", text: "Produkter som kommer" },
      {
        type: "p",
        text: "De här produkterna finns redan i vår katalog. Följ dem för att se när butikerna lägger upp dem och vad de kostar hos var och en.",
      },
      {
        type: "links",
        items: [
          { href: "/produkter/delta-reign-elite-trainer-box", label: "Delta Reign Elite Trainer Box" },
          {
            href: "/produkter/pokemon-mega-evolution-delta-reign-pokemon-center-elite-trainer-box-etb",
            label: "Delta Reign Pokémon Center Elite Trainer Box",
          },
          { href: "/produkter/delta-reign-booster-box", label: "Delta Reign Booster Box" },
          {
            href: "/produkter/pokemon-mega-evolution-delta-reign-half-booster-display-eng",
            label: "Delta Reign Half Booster Display",
          },
          { href: "/produkter/delta-reign-booster-bundle", label: "Delta Reign Booster Bundle" },
          { href: "/produkter/delta-reign-booster", label: "Delta Reign Booster" },
          { href: "/produkter/delta-reign-sleeved-booster", label: "Delta Reign Sleeved Booster" },
          { href: "/produkter/delta-reign-seel-3-pack-blister", label: "Delta Reign: Seel 3-Pack Blister" },
          {
            href: "/produkter/pokemon-mega-evolution-delta-reign-1-pack-blister-spritzee-eng",
            label: "Delta Reign: Spritzee 1-Pack Blister",
          },
          {
            href: "/produkter/pokemon-mega-evolution-delta-reign-1-pack-premium-checklane-blister-ampharos-flaaffy-mareep-eng",
            label: "Delta Reign: Ampharos Premium Checklane Blister",
          },
          {
            href: "/produkter/pokemon-mega-evolution-delta-reign-1-pack-premium-checklane-blister-delphox-braixen-fennekin-eng",
            label: "Delta Reign: Delphox Premium Checklane Blister",
          },
        ],
      },
      { type: "h", text: "Vilka kort blir dyrast?" },
      {
        type: "p",
        text: "Det vet ingen förrän setet är släppt och de första korten säljs. Vi gissar inte. Singelkorten läggs in i katalogen när setet släpps, och då ser du på setsidan vilka som är dyrast enligt Cardmarket just nu.",
      },
      { type: "h", text: "Så missar du inte släppet" },
      {
        type: "p",
        text: "Populära set tar ofta slut snabbt i de svenska butikerna. Bevaka en produkt i Foilio så säger vi till när den kommer i lager hos någon av de över 40 butikerna vi följer. I vår Discord postas påfyllningarna, oftast inom en minut.",
      },
      {
        type: "links",
        items: [
          { href: "/sets/cmtnj78kh0000ecn60yv8dti6", label: "Alla Delta Reign-produkter", note: "Setsidan med aktuella priser" },
          { href: "/discord", label: "Foilios Discord", note: "Restock-larm från svenska butiker" },
          { href: "/sets/cmsj7zlx400bcn4gaklmtzqk2", label: "Storm Emeralda (japanska)", note: "Samma kort, släppta i Japan i juli" },
          { href: "/guider/kommande-pokemon-set", label: "Alla kommande set", note: "Engelska och japanska släppdatum" },
        ],
      },
    ],
    sources: [
      { label: "Bulbapedia: Delta Reign (TCG)", url: "https://bulbapedia.bulbagarden.net/wiki/Delta_Reign_(TCG)" },
      {
        label: "Pokémon: The Pokémon TCG: Mega Evolution—Delta Reign Expansion Arrives November 6, 2026",
        url: "https://www.pokemon.com/us/news/the-pokemon-tcg-mega-evolution-delta-reign-expansion-arrives-november-6-2026",
      },
      {
        label: "Pokémon: Seize the Crown with Pokémon TCG: Mega Evolution—Delta Reign",
        url: "https://www.pokemon.com/us/features/heat-rotom-ex-delibird-and-more-from-pokemon-tcg-mega-evolution-delta-reign",
      },
    ],
  },
  {
    slug: "30th-celebration",
    title: "Pokémon 30th Celebration: kortlista, Classic Collection och alla produkter",
    description:
      "30th Celebration firar 30 år av Pokémon-kortspelet. Här är setets upplägg, vad som finns i varje booster, Classic Collection och när produkterna släpps.",
    kind: "set",
    publishedAt: "2026-09-23",
    updatedAt: "2026-09-23",
    setId: "cms68t7hc0000aw9sr3ocbldn",
    intro:
      "Pokémon-kortspelet fyller 30 år, och 30th Celebration är jubileumssetet. Det släpptes 16 september 2026 samtidigt i hela världen, som det första setet någonsin. Alla kort är foil, 30 olika Pikachu-illustrationer finns i boostrarna, och en Classic Collection trycker om kort från tre decennier.",
    facts: [
      { label: "Släppdatum", value: "16 september 2026 (samtidigt över hela världen)" },
      { label: "Serie", value: "Mega Evolution" },
      { label: "Huvudsetet", value: "128 kort, plus secret rares ovanför numret" },
      { label: "Classic Collection", value: "30 omtryckta klassiker" },
      { label: "I varje booster", value: "5 foilkort (varav en av 30 Pikachu) + 1 foil-energi" },
    ],
    body: [
      { type: "h", text: "Hur är setet uppbyggt?" },
      {
        type: "p",
        text: "Huvudsetet har 128 kort med motiv i dag- och nattmiljöer, och ovanför det finns secret rares. Varje booster innehåller fem foilkort, varav ett är en av 30 unika Pikachu-illustrationer, plus ett foilkort med Basic Energy. Setet har alltså inga vanliga icke-foilkort alls.",
      },
      { type: "h", text: "Classic Collection" },
      {
        type: "p",
        text: "Classic Collection är 30 kända kort ur spelets historia, tryckta på nytt med 30-årslogotypen. Där finns bland annat Charizard från Base Set, Lugia, Shining Celebi, Dark Tyranitar och Rayquaza-EX. Ultra-Premium Collection-lådorna innehåller en egen Classic Collection-booster.",
      },
      {
        type: "links",
        items: [
          { href: "/sets/cmu9kkvbx0001ggzkvjnhalnt", label: "Alla Classic Collection-kort", note: "Med aktuella priser" },
          { href: "/produkter/charizard-30c-bs004", label: "Charizard (Classic Collection)" },
          { href: "/produkter/lugia-30c-aq149", label: "Lugia (Classic Collection)" },
        ],
      },
      { type: "h", text: "Vilka kort är dyrast just nu?" },
      {
        type: "p",
        text: "Så här såg toppen ut enligt Cardmarket 23 september 2026, en vecka efter släppet. Tidigt i ett sets liv rör sig priserna snabbt, så klicka in för dagens pris.",
      },
      {
        type: "links",
        items: [
          { href: "/produkter/mew-30c-b-rgb", label: "Mew (B/128)" },
          { href: "/produkter/mew-30c-r-rgb", label: "Mew (R/128)" },
          { href: "/produkter/mew-30c-g-rgb", label: "Mew (G/128)" },
          { href: "/produkter/mew-ex-30c-152", label: "Mew ex (152/128)" },
          { href: "/produkter/gengar-ex-30c-154", label: "Gengar ex (154/128)" },
          { href: "/produkter/pikachu-ex-30c-150", label: "Pikachu ex (150/128)" },
          { href: "/produkter/mewtwo-ex-30c-151", label: "Mewtwo ex (151/128)" },
        ],
      },
      { type: "h", text: "Produkter och släppdatum" },
      {
        type: "p",
        text: "30th Celebration släpps i omgångar fram till december. Datumen nedan är Pokémons officiella och kan skilja sig något mellan länder.",
      },
      {
        type: "list",
        items: [
          "16 september: Elite Trainer Box (9 boosters), Pokémon Center Elite Trainer Box (11 boosters), Sylveon ex Box och Greninja ex Box (4 boosters var), Poster Collection (3 boosters), Tech Sticker Collection (3 boosters) och Knock Out Collection (2 boosters).",
          "2 oktober: Booster Bundle (6 boosters) och tio olika Mini Tins (2 boosters var).",
          "30 oktober: Battle Decks med Espeon ex och Umbreon ex.",
          "6 november: Ditto Premium Collection (8 boosters), Ultra-Premium Collection i Espeon- och Umbreon-versionerna (29 boosters + 1 Classic Collection-booster) samt Figure Collection med Mew eller Mewtwo (5 boosters).",
          "4 december: Binder Collection (5 boosters).",
        ],
      },
      {
        type: "links",
        items: [
          { href: "/produkter/30th-celebration-elite-trainer-box", label: "30th Celebration Elite Trainer Box" },
          {
            href: "/produkter/30th-celebration-pokemon-center-elite-trainer-box",
            label: "30th Celebration Pokémon Center Elite Trainer Box",
          },
          { href: "/produkter/30th-celebration-booster-bundle", label: "30th Celebration Booster Bundle" },
          {
            href: "/produkter/30th-celebration-umbreon-ultra-premium-collection",
            label: "Umbreon Ultra-Premium Collection",
          },
          {
            href: "/produkter/30th-celebration-espeon-ultra-premium-collection",
            label: "Espeon Ultra-Premium Collection",
          },
          { href: "/produkter/30th-celebration-ditto-premium-collection", label: "Ditto Premium Collection" },
          { href: "/produkter/30th-celebration-mini-tin-display", label: "Mini Tin Display" },
          { href: "/sets/cms68t7hc0000aw9sr3ocbldn", label: "Alla 30th Celebration-produkter", note: "Setsidan" },
        ],
      },
    ],
    sources: [
      {
        label: "Pokémon: Pokémon TCG: 30th Celebration Product Showcase",
        url: "https://www.pokemon.com/us/news/pokemon-tcg-30th-celebration-product-showcase",
      },
      {
        label: "Pokémon: The Pokémon TCG: 30th Celebration Expansion Is Available Now",
        url: "https://www.pokemon.com/us/news/the-pokemon-tcg-30th-celebration-expansion-is-available-now",
      },
    ],
  },
  {
    slug: "pitch-black",
    title: "Pokémon Pitch Black: kortlista, Mega Darkrai ex och alla produkter",
    description:
      "Pitch Black släpptes 17 juli 2026 med Mega Darkrai ex och Mega Zeraora ex. Här är setets fakta, de mest eftertraktade korten och vad produkterna innehåller.",
    kind: "set",
    publishedAt: "2026-09-23",
    updatedAt: "2026-09-23",
    setId: "cmrreegww0001173z06a8i647",
    intro:
      "Pitch Black är Mega Evolution-seriens femte huvudset, och det är mörkt på riktigt: Mega Darkrai ex och Mega Zeraora ex leder setet. Det bygger på Mega-Pokémon från Mega Dimension-tillägget till Pokémon Legends: Z-A.",
    facts: [
      { label: "Släppdatum", value: "17 juli 2026" },
      { label: "Serie", value: "Mega Evolution" },
      { label: "Antal kort", value: "120 (84 + 36 secret rares)" },
      { label: "Huvudkort", value: "Mega Darkrai ex, Mega Zeraora ex, Mega Chandelure ex, Mega Excadrill ex" },
      { label: "Japansk motsvarighet", value: "Abyss Eye" },
    ],
    body: [
      { type: "h", text: "Vad finns i setet?" },
      {
        type: "p",
        text: "Pitch Black har 120 kort: 84 i huvudsetet och 36 secret rares. Förutom Mega Darkrai ex och Mega Zeraora ex finns Mega Chandelure ex och Mega Excadrill ex, och Mega-korten har etsad (texturerad) yta. Mega Darkrai ex finns dessutom som Mega Hyper Rare, setets mest sällsynta kort.",
      },
      { type: "h", text: "De mest eftertraktade korten" },
      {
        type: "p",
        text: "Så här såg toppen ut enligt Cardmarket 23 september 2026. Klicka in för dagens pris och prishistorik.",
      },
      {
        type: "links",
        items: [
          { href: "/produkter/mega-darkrai-ex-me5-116", label: "Mega Darkrai ex (116/84)" },
          { href: "/produkter/mega-darkrai-ex-me5-120", label: "Mega Darkrai ex (120/84)" },
          { href: "/produkter/mega-chandelure-ex-me5-115", label: "Mega Chandelure ex (115/84)" },
          { href: "/produkter/gwynn-me5-119", label: "Gwynn (119/84)" },
          { href: "/produkter/gladion-s-final-battle-me5-118", label: "Gladion's Final Battle (118/84)" },
        ],
      },
      { type: "h", text: "Vad innehåller produkterna?" },
      {
        type: "list",
        items: [
          "Elite Trainer Box: 9 boosters och ett full-art foil-promokort med Zarude.",
          "Pokémon Center Elite Trainer Box: 11 boosters, Zarude-promot med Pokémon Center-logga, 65 kortfickor, tärningar och energikort.",
          "Booster Box (display): 36 boosters.",
          "Booster Bundle: 6 boosters.",
          "Build & Battle Box: en färdig 40-kortslek med ett av fyra foil-promokort, plus 4 boosters.",
        ],
      },
      {
        type: "links",
        items: [
          { href: "/produkter/pitch-black-elite-trainer-box", label: "Pitch Black Elite Trainer Box" },
          {
            href: "/produkter/pitch-black-pokemon-center-elite-trainer-box",
            label: "Pitch Black Pokémon Center Elite Trainer Box",
          },
          { href: "/produkter/pitch-black-booster-box", label: "Pitch Black Booster Box" },
          { href: "/produkter/pitch-black-booster-bundle", label: "Pitch Black Booster Bundle" },
          { href: "/produkter/pitch-black-build-battle-box", label: "Pitch Black Build & Battle Box" },
          { href: "/sets/cmrreegww0001173z06a8i647", label: "Alla Pitch Black-produkter", note: "Setsidan" },
          { href: "/sets/cmsj3qex8000014oizz36uwgd", label: "Abyss Eye (japanska)", note: "Samma kort, släppta i Japan i maj" },
        ],
      },
    ],
    sources: [
      {
        label: "Pokémon: Mega Evolution—Pitch Black Expansion Overview",
        url: "https://tcg.pokemon.com/en-us/expansions/pitch-black/",
      },
      {
        label: "Bulbapedia: Pitch Black (TCG)",
        url: "https://bulbapedia.bulbagarden.net/wiki/Pitch_Black_(TCG)",
      },
    ],
  },
  {
    slug: "kommande-pokemon-set",
    title: "Kommande Pokémon-set 2026–2027: släppdatum för engelska och japanska set",
    description:
      "Alla kommande Pokémon TCG-set med släppdatum: Delta Reign, Aura Seeker, MEGA x MEGA Parade och vad som har visats för 2027. Engelska och japanska set på ett ställe.",
    kind: "calendar",
    publishedAt: "2026-09-23",
    updatedAt: "2026-09-23",
    intro:
      "Här samlar vi alla Pokémon-set som är på väg, både engelska och japanska. Japan släpper först och de engelska seten bygger på de japanska, så den japanska kalendern visar vad som kommer hit några månader senare. Det Pokémon har bekräftat står i listorna. Läckor och rykten står i en egen ruta märkt som obekräftade.",
    body: [
      { type: "h", text: "Kommande engelska set" },
      {
        type: "list",
        items: [
          "6 november 2026: Delta Reign, med Mega Rayquaza ex.",
          "30th Celebration fortsätter med fler produkter: Booster Bundle och Mini Tins 2 oktober, Battle Decks 30 oktober, Ultra-Premium-, Premium- och Figure Collections 6 november och Binder Collection 4 december.",
        ],
      },
      {
        type: "links",
        items: [
          { href: "/guider/delta-reign", label: "Guide: Delta Reign" },
          { href: "/guider/30th-celebration", label: "Guide: 30th Celebration" },
        ],
      },
      { type: "h", text: "Kommande japanska set" },
      {
        type: "list",
        items: [
          "27 november 2026: Aura Seeker (ハドウシーカー), med Mega Lucario Z ex, den första Z-Mega Evolution i kortspelet.",
          "19 februari 2027: MEGA x MEGA Parade (MEGA×MEGAパレード), en High Class Pack med Mega Raichu X och Mega Raichu Y.",
        ],
      },
      {
        type: "links",
        items: [
          { href: "/guider/aura-seeker", label: "Guide: Aura Seeker" },
          { href: "/guider/mega-x-mega-parade", label: "Guide: MEGA x MEGA Parade" },
        ],
      },
      { type: "h", text: "Visat men utan släppdatum" },
      {
        type: "p",
        text: "När VM i Pokémon avslutades 31 augusti 2026 visade Pokémon flera saker som kommer men som ännu inte har något datum:",
      },
      {
        type: "list",
        items: [
          "Mega Lucario Z ex och Sigilyph ex. Kortens engelska versioner bär setkoden FLO, så de hamnar i ett engelskt set vars namn börjar på F.",
          "Mega Attack Rare, en ny typ av kort. Mega Rayquaza ex, Mega Darkrai ex, Mega Greninja ex och Mega Zygarde ex visades.",
          "En ny ex★-serie (ex Star), med Raikou, Entei och Suicune i den första teasern.",
        ],
      },
      {
        type: "note",
        tone: "rumor",
        title: "Obekräftat: nästa engelska set",
        text: "Butikslistningar pekar på att setet med Mega Lucario Z ex (koden FLO) släpps på engelska i början av 2027. Pokémon har varken bekräftat namn eller datum. Vi uppdaterar guiden när det kommer ett besked.",
      },
      { type: "h", text: "Så hänger japanska och engelska set ihop" },
      {
        type: "p",
        text: "Varje engelskt set i Mega Evolution-serien bygger på ett japanskt set som släppts tidigare. Under 2026 har avståndet varit ungefär två månader. Delta Reign kommer drygt tre månader efter sin japanska förlaga, med 30th Celebration emellan.",
      },
      {
        type: "list",
        items: [
          "Nihil Zero (Japan 23 januari) → Perfect Order (27 mars)",
          "Ninja Spinner (Japan 13 mars) → Chaos Rising (22 maj)",
          "Abyss Eye (Japan 22 maj) → Pitch Black (17 juli)",
          "Storm Emeralda (Japan 31 juli) → Delta Reign (6 november)",
        ],
      },
      {
        type: "links",
        items: [
          { href: "/sets/cmsj3qkmz000u14oisq7h9z20", label: "Nihil Zero", note: "Japanska" },
          { href: "/sets/cmq97mnnm000gxurq6vvy4cqc", label: "Perfect Order", note: "Engelska" },
          { href: "/sets/cmsj3qm00001314oimo8w1elm", label: "Ninja Spinner", note: "Japanska" },
          { href: "/sets/cmq97mnnq000hxurqrrmblcz4", label: "Chaos Rising", note: "Engelska" },
          { href: "/sets/cmsj3qex8000014oizz36uwgd", label: "Abyss Eye", note: "Japanska" },
          { href: "/sets/cmrreegww0001173z06a8i647", label: "Pitch Black", note: "Engelska" },
          { href: "/sets/cmsj7zlx400bcn4gaklmtzqk2", label: "Storm Emeralda", note: "Japanska" },
        ],
      },
      { type: "h", text: "Missa inte släppen" },
      {
        type: "p",
        text: "Bevaka en produkt i Foilio så säger vi till när den kommer i lager hos någon av de över 40 svenska butikerna vi följer. I vår Discord postas påfyllningarna, oftast inom en minut.",
      },
      {
        type: "links",
        items: [
          { href: "/sets", label: "Alla set", note: "Engelska och japanska" },
          { href: "/discord", label: "Foilios Discord", note: "Restock-larm från svenska butiker" },
        ],
      },
    ],
    sources: [
      {
        label: "Pokémon: The Pokémon TCG: Mega Evolution—Delta Reign Expansion Arrives November 6, 2026",
        url: "https://www.pokemon.com/us/news/the-pokemon-tcg-mega-evolution-delta-reign-expansion-arrives-november-6-2026",
      },
      {
        label: "Pokémon: Pokémon TCG: 30th Celebration Product Showcase",
        url: "https://www.pokemon.com/us/news/pokemon-tcg-30th-celebration-product-showcase",
      },
      {
        label: "PokéBeach: \"Aura Seeker\" Japanese TCG Set to Release in November",
        url: "https://www.pokebeach.com/2026/05/aura-seeker-japanese-tcg-set-to-release-in-november",
      },
      {
        label: "PokéBeach: \"MEGA x MEGA Parade\" High Class Pokemon TCG Set to Release in February",
        url: "https://www.pokebeach.com/2026/08/mega-x-mega-parade-high-class-pokemon-tcg-set-to-release-in-february",
      },
      {
        label: "PokeGuardian: Mega Lucario Z ex revealed, Mega Attack Rare cards revealed & ex Star series teased",
        url: "https://www.pokeguardian.com/3346278_mega-lucario-z-ex-revealed-more-mega-attack-rare-cards-revealed-ex-star-series-teased",
      },
      {
        label: "Bulbapedia: Mega Lucario Z ex (FLO 58)",
        url: "https://bulbapedia.bulbagarden.net/wiki/Mega_Lucario_Z_ex_(FLO_58)",
      },
      { label: "Bulbapedia: Perfect Order (TCG)", url: "https://bulbapedia.bulbagarden.net/wiki/Perfect_Order_(TCG)" },
      { label: "Bulbapedia: Chaos Rising (TCG)", url: "https://bulbapedia.bulbagarden.net/wiki/Chaos_Rising_(TCG)" },
      { label: "Bulbapedia: Pitch Black (TCG)", url: "https://bulbapedia.bulbagarden.net/wiki/Pitch_Black_(TCG)" },
      { label: "Bulbapedia: Delta Reign (TCG)", url: "https://bulbapedia.bulbagarden.net/wiki/Delta_Reign_(TCG)" },
    ],
  },
  {
    slug: "aura-seeker",
    title: "Aura Seeker: japanska setet med Mega Lucario Z ex – släppdatum och det vi vet",
    description:
      "Aura Seeker (ハドウシーカー) släpps i Japan 27 november 2026 med Mega Lucario Z ex, den första Z-Mega Evolution. Här är det som är bekräftat och när setet kan komma på engelska.",
    kind: "set",
    publishedAt: "2026-09-23",
    updatedAt: "2026-09-23",
    intro:
      "Aura Seeker är nästa japanska huvudset i Mega Evolution-serien, och det för in något helt nytt: Z-Mega Evolution. Stjärnan är Mega Lucario Z ex, en ny Mega-form från Mega Dimension-tillägget till Pokémon Legends: Z-A. Här är det som är känt hittills.",
    facts: [
      { label: "Släppdatum", value: "27 november 2026 (Japan)" },
      { label: "Japanskt namn", value: "ハドウシーカー (Hadou Seeker)" },
      { label: "Serie", value: "Mega Evolution" },
      { label: "Huvudkort", value: "Mega Lucario Z ex" },
      { label: "Engelsk version", value: "Inte annonserad ännu" },
    ],
    body: [
      { type: "h", text: "Vad är Z-Mega Evolution?" },
      {
        type: "p",
        text: "Z-Mega Evolution är nya Mega-former som introducerades i Mega Dimension, tillägget till Pokémon Legends: Z-A. Mega Lucario Z ex är det första sådana kortet i kortspelet. Kortets förmåga heter just Aura Seeker och låter dig söka upp ett Supporter-kort ur leken.",
      },
      { type: "h", text: "Kort som har visats" },
      {
        type: "p",
        text: "Mega Lucario Z ex och Sigilyph ex visades när VM i Pokémon avslutades 31 augusti 2026. Resten av kortlistan presenteras normalt av Pokémon Japan veckorna före släppet. Vi fyller på guiden när den kommer.",
      },
      { type: "h", text: "När kommer Aura Seeker på engelska?" },
      {
        type: "p",
        text: "Det är inte annonserat. De engelska versionerna av Mega Lucario Z ex bär setkoden FLO, så korten hamnar i ett engelskt set vars namn börjar på F. Under 2026 har de engelska seten kommit ungefär två till tre månader efter de japanska.",
      },
      {
        type: "note",
        tone: "rumor",
        title: "Obekräftat",
        text: "Butikslistningar pekar på ett engelskt släpp i början av 2027. Pokémon har inte bekräftat varken namn eller datum.",
      },
      { type: "h", text: "Köpa japanska boosters i Sverige" },
      {
        type: "p",
        text: "Japanska boosters säljs av flera svenska butiker, ofta som förbeställning veckorna före släppet. När Aura Seeker-produkterna dyker upp hos butikerna vi följer läggs de in i katalogen.",
      },
      {
        type: "links",
        items: [
          { href: "/guider/kommande-pokemon-set", label: "Alla kommande set", note: "Engelska och japanska släppdatum" },
          { href: "/guider/japanska-pokemonkort", label: "Japanska eller engelska kort?", note: "Skillnaderna förklarade" },
          { href: "/sets/cmsj7zlx400bcn4gaklmtzqk2", label: "Storm Emeralda", note: "Förra japanska huvudsetet" },
        ],
      },
    ],
    sources: [
      {
        label: "PokéBeach: \"Aura Seeker\" Japanese TCG Set to Release in November",
        url: "https://www.pokebeach.com/2026/05/aura-seeker-japanese-tcg-set-to-release-in-november",
      },
      { label: "Bulbapedia: Aura Seeker (TCG)", url: "https://bulbapedia.bulbagarden.net/wiki/Aura_Seeker_(TCG)" },
      {
        label: "Bulbapedia: Mega Lucario Z ex (FLO 58)",
        url: "https://bulbapedia.bulbagarden.net/wiki/Mega_Lucario_Z_ex_(FLO_58)",
      },
      {
        label: "PokeGuardian: Mega Lucario Z ex revealed, Mega Attack Rare cards revealed & ex Star series teased",
        url: "https://www.pokeguardian.com/3346278_mega-lucario-z-ex-revealed-more-mega-attack-rare-cards-revealed-ex-star-series-teased",
      },
    ],
  },
  {
    slug: "mega-x-mega-parade",
    title: "MEGA x MEGA Parade: japansk High Class Pack med Mega Raichu – släppdatum och innehåll",
    description:
      "MEGA x MEGA Parade släpps i Japan 19 februari 2027 som High Class Pack med Mega Raichu X och Y. Här är vad en High Class Pack är och vad som är bekräftat om setet.",
    kind: "set",
    publishedAt: "2026-09-23",
    updatedAt: "2026-09-23",
    intro:
      "Japans High Class Packs är premiumset med dyrare boosters, fler kort per paket och ett garanterat fint kort i varje. Nästa heter MEGA x MEGA Parade, och i centrum står Mega Raichu X och Mega Raichu Y.",
    facts: [
      { label: "Släppdatum", value: "19 februari 2027 (Japan)" },
      { label: "Japanskt namn", value: "MEGA×MEGAパレード" },
      { label: "Typ", value: "High Class Pack" },
      { label: "I varje booster", value: "10 kort, varav ett garanterat high-rarity-kort" },
      { label: "Rekommenderat pris i Japan", value: "550 yen per booster" },
      { label: "Huvudkort", value: "Mega Raichu X och Mega Raichu Y" },
      { label: "Engelsk version", value: "Inte annonserad ännu" },
    ],
    body: [
      { type: "h", text: "Vad är en High Class Pack?" },
      {
        type: "p",
        text: "En vanlig japansk booster har fem kort och ingen garanti. En High Class Pack har tio kort och minst ett high-rarity-kort i varje paket. Innehållet är till stor del kort från årets tidigare set, kompletterat med nya specialillustrationer som bara finns här. Det gör seten populära både hos spelare som missat kort och hos samlare som jagar de nya illustrationerna.",
      },
      { type: "h", text: "Mega Raichu X och Mega Raichu Y" },
      {
        type: "p",
        text: "Båda formerna kommer från Mega Dimension, tillägget till Pokémon Legends: Z-A. Som namnet antyder innehåller setet även många andra Mega Evolution-kort.",
      },
      { type: "h", text: "Varför i februari?" },
      {
        type: "p",
        text: "High Class Packs har tidigare släppts i november eller december. Den här kommer i februari, efter att 30th Celebration släpptes samtidigt över hela världen i september.",
      },
      { type: "h", text: "Kommer den på engelska?" },
      {
        type: "p",
        text: "Det är inte annonserat. Pokémon visade nya Mega Attack Rare-kort (Mega Rayquaza ex, Mega Darkrai ex, Mega Greninja ex och Mega Zygarde ex) vid VM i augusti, men vilka engelska produkter de hamnar i är inte bekräftat.",
      },
      {
        type: "note",
        tone: "rumor",
        title: "Obekräftat",
        text: "Mega Attack Rare-korten som visades vid VM kopplas av flera nyhetssajter till just den här High Class Packen. Pokémon har inte sagt det.",
      },
      {
        type: "links",
        items: [
          { href: "/guider/kommande-pokemon-set", label: "Alla kommande set", note: "Engelska och japanska släppdatum" },
          { href: "/guider/japanska-pokemonkort", label: "Japanska eller engelska kort?", note: "Skillnaderna förklarade" },
        ],
      },
    ],
    sources: [
      {
        label: "PokéBeach: \"MEGA x MEGA Parade\" High Class Pokemon TCG Set to Release in February",
        url: "https://www.pokebeach.com/2026/08/mega-x-mega-parade-high-class-pokemon-tcg-set-to-release-in-february",
      },
      {
        label: "Tech Times: Pokémon TCG Japan High Class Pack Crowns Mega Raichu Its February 2027 Headliner",
        url: "https://www.techtimes.com/articles/325739/20260827/pokemon-tcg-japan-high-class-pack-crowns-mega-raichu-its-february-2027-headliner.htm",
      },
      {
        label: "PokeGuardian: Mega Lucario Z ex revealed, Mega Attack Rare cards revealed & ex Star series teased",
        url: "https://www.pokeguardian.com/3346278_mega-lucario-z-ex-revealed-more-mega-attack-rare-cards-revealed-ex-star-series-teased",
      },
    ],
  },
  {
    slug: "japanska-pokemonkort",
    title: "Japanska eller engelska Pokémonkort? Skillnaderna du bör känna till",
    description:
      "Japanska Pokémonkort släpps tidigare, har andra paket och ett eget pris. Så skiljer sig japanska och engelska kort och vad du ska tänka på när du köper eller värderar dem.",
    kind: "guide",
    publishedAt: "2026-09-23",
    updatedAt: "2026-09-23",
    intro:
      "Allt fler svenska samlare köper japanska Pokémonkort. Motiven är desamma, men korten släpps vid andra tidpunkter, i andra paket och har egna marknadspriser. Här är skillnaderna.",
    body: [
      { type: "h", text: "Japan släpper först" },
      {
        type: "p",
        text: "Varje engelskt set i Mega Evolution-serien bygger på ett japanskt set som kommit tidigare. Under 2026 har avståndet varit ungefär två till tre månader. Pitch Black kom till exempel på engelska i juli, två månader efter japanska Abyss Eye. Vill du se ett set först, titta på den japanska kalendern.",
      },
      {
        type: "links",
        items: [{ href: "/guider/kommande-pokemon-set", label: "Kommande set", note: "Japanska och engelska släppdatum" }],
      },
      { type: "h", text: "Olika paket" },
      {
        type: "p",
        text: "En vanlig japansk booster innehåller fem kort, mot tio i en engelsk. Japanska premiumset, så kallade High Class Packs, har tio kort och ett garanterat fint kort i varje paket. Produktlinjerna skiljer sig också, så en japansk box och en engelsk Booster Box innehåller olika antal paket.",
      },
      { type: "h", text: "Olika set-indelning" },
      {
        type: "p",
        text: "Ett engelskt set är inte alltid en exakt kopia av ett japanskt. Delta Reign innehåller till exempel kort från både Storm Emeralda och de japanska ex Starter Sets. Numret på kortet skiljer sig därför ofta mellan språken.",
      },
      { type: "h", text: "Eget pris för varje språk" },
      {
        type: "p",
        text: "Ett japanskt och ett engelskt exemplar av samma kort är olika varor med olika marknader och priser. Ibland är det japanska billigare, ibland dyrare. Jämför därför alltid med priset för samma språk som ditt kort. Foilio har japanska singlar och sealed i katalogen, med egna priser skilda från de engelska.",
      },
      {
        type: "links",
        items: [
          { href: "/sets", label: "Alla set", note: "Engelska och japanska" },
          { href: "/guider/vad-ar-mina-pokemonkort-varda", label: "Vad är mina kort värda?", note: "Så värderar du dina kort" },
        ],
      },
    ],
    sources: [
      { label: "Bulbapedia: Pitch Black (TCG)", url: "https://bulbapedia.bulbagarden.net/wiki/Pitch_Black_(TCG)" },
      { label: "Bulbapedia: Delta Reign (TCG)", url: "https://bulbapedia.bulbagarden.net/wiki/Delta_Reign_(TCG)" },
      {
        label: "Tech Times: Pokémon TCG Japan High Class Pack Crowns Mega Raichu Its February 2027 Headliner",
        url: "https://www.techtimes.com/articles/325739/20260827/pokemon-tcg-japan-high-class-pack-crowns-mega-raichu-its-february-2027-headliner.htm",
      },
    ],
  },
  {
    slug: "vad-ar-mina-pokemonkort-varda",
    title: "Vad är mina Pokémonkort värda? Så tar du reda på det",
    description:
      "Så kollar du vad ett Pokémonkort är värt: rätt tryckning, skick och språk, varför Cardmarket är referensen i Europa, och hur graderade kort skiljer sig.",
    kind: "guide",
    publishedAt: "2026-09-23",
    updatedAt: "2026-09-23",
    intro:
      "Hittat en gammal pärm eller fått en träff i en booster? Ett korts värde avgörs av mer än namnet. Samma Pokémon kan vara värd en krona eller flera tusen beroende på tryckning, skick och språk. Så här tar du reda på vad just ditt kort är värt.",
    body: [
      { type: "h", text: "1. Hitta exakt rätt kort" },
      {
        type: "p",
        text: "Titta längst ned på kortet. Där står numret (till exempel 4/102) och en setsymbol. Numret och setet tillsammans är kortets identitet. Två kort med samma namn från olika set är olika kort med helt olika priser.",
      },
      {
        type: "p",
        text: "Kontrollera sedan tryckningen. Är kortet reverse holo (glansigt runt bilden), 1st Edition (stämpel till vänster under bilden) eller en specialvariant? Varje tryckning är en egen vara med eget pris.",
      },
      { type: "h", text: "2. Bedöm skicket ärligt" },
      {
        type: "p",
        text: "Priser anges oftast för Near Mint, alltså nästan nyskick: skarpa hörn, inga repor på ytan och jämna kanter. Ett kort med vita kanter, böjar eller repor säljs för betydligt mindre. Titta på kortet i starkt ljus innan du jämför med ett Near Mint-pris.",
      },
      { type: "h", text: "3. Språket spelar roll" },
      {
        type: "p",
        text: "Engelska och japanska kort är olika varor med olika marknader. Jämför alltid med priset för samma språk som ditt kort.",
      },
      { type: "h", text: "4. Använd en riktig marknadsreferens" },
      {
        type: "p",
        text: "I Europa är Cardmarket den största marknadsplatsen för Pokémonkort, och dess priser är den vanligaste referensen. Titta på vad kortet faktiskt säljs för hos många säljare, inte på ett enskilt högt utropspris.",
      },
      { type: "h", text: "5. Graderade kort är en egen vara" },
      {
        type: "p",
        text: "Ett kort som betygsatts och förseglats av ett graderingsbolag (till exempel PSA, CGC eller Beckett) säljs för ett annat pris än samma kort ograderat. En PSA 10 kan vara värd många gånger mer än det lösa kortet, men bara om kortet verkligen får toppbetyg. Jämför aldrig ett ograderat korts pris med en graderad försäljning.",
      },
      { type: "h", text: "Snabbast: skanna kortet" },
      {
        type: "p",
        text: "I Foilio-appen kan du skanna kortet med kameran. Vi läser av numret och setet och visar kortets pris direkt. Lägg korten i din samling så räknar vi ut samlingens värde utifrån Cardmarkets priser och följer hur det förändras.",
      },
      {
        type: "links",
        items: [
          { href: "/skanna", label: "Skanna ett kort", note: "Kortskannern" },
          { href: "/sets", label: "Bläddra bland alla set", note: "Hitta ditt kort via setet" },
        ],
      },
    ],
    sources: [],
  },
];

export function getGuide(slug: string): Guide | null {
  return GUIDES.find((g) => g.slug === slug) ?? null;
}

/** Guiden som hör till ett set, för länken på setsidan. DB-fri. */
export function guideForSet(setId: string): Guide | null {
  return GUIDES.find((g) => g.setId === setId) ?? null;
}

/**
 * Kalendern ("kommande set") först — den är navet som länkar till resten och den
 * sida en besökare oftast letar efter. Sedan nyast först; vid samma datum behålls
 * filens ordning (den är redaktionell).
 */
export function guidesNewestFirst(): Guide[] {
  return GUIDES.map((g, i) => ({ g, i }))
    .sort(
      (a, b) =>
        Number(b.g.kind === "calendar") - Number(a.g.kind === "calendar") ||
        b.g.publishedAt.localeCompare(a.g.publishedAt) ||
        a.i - b.i
    )
    .map(({ g }) => g);
}
