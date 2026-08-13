/**
 * detectListingLanguage / isBlockedListingLanguage: japanska = OK, kinesiska/koreanska
 * blockade "for now". Titel-baserad (vi lagrar inget separat språk på scrapade produkter).
 */
import { describe, expect, it } from "vitest";
import { detectListingLanguage, isBlockedListingLanguage, listingCardLanguage } from "@/lib/listing-language";

describe("detectListingLanguage", () => {
  it("japanska (ord + kana)", () => {
    expect(detectListingLanguage("Pokémon Abyss Eye Booster Box (Japansk)")).toBe("JP");
    expect(detectListingLanguage("Scarlet & Violet SV10 Booster Box (Japanese)")).toBe("JP");
    expect(detectListingLanguage("ナッシー[Exeggutor] Evolutions")).toBe("JP");
  });
  it("kinesiska + koreanska", () => {
    expect(detectListingLanguage("Gem Pack Vol 5 Booster Box (Simplified Chinese)")).toBe("CN");
    expect(detectListingLanguage("151 Figure Blind Collection Box (Kinesisk)")).toBe("CN");
    expect(detectListingLanguage("Mega Dream M2A Booster (Koreansk)")).toBe("KR");
  });
  it("engelska som standard", () => {
    expect(detectListingLanguage("Surging Sparks Booster Box")).toBe("EN");
  });

  it("blockar kinesiska/koreanska men inte japanska/engelska", () => {
    expect(isBlockedListingLanguage("Gem Pack (Simplified Chinese)")).toBe(true);
    expect(isBlockedListingLanguage("Shield Booster Pack (Koreansk)")).toBe(true);
    expect(isBlockedListingLanguage("Abyss Eye Booster Box (Japansk)")).toBe(false);
    expect(isBlockedListingLanguage("Surging Sparks Booster Box")).toBe(false);
  });

  it("enum-tagg: JP→JP, CN/KR→OTHER, annars EN", () => {
    expect(listingCardLanguage("Abyss Eye (Japansk)")).toBe("JP");
    expect(listingCardLanguage("Gem Pack (Simplified Chinese)")).toBe("OTHER");
    expect(listingCardLanguage("Shield Booster (Koreansk)")).toBe("OTHER");
    expect(listingCardLanguage("Surging Sparks Booster Box")).toBe("EN");
  });

  it("kinesiska produktlinjer med LATINSK titel (Gem Pack / 151C)", () => {
    // DL:s kinesiska Gem Pack — inget 'chinese' i titeln, men linjen är CN-exklusiv.
    expect(detectListingLanguage("Pokémon TCG -Gem Pack Vol 3 151 C Booster Box")).toBe("CN");
    expect(detectListingLanguage("Pokemon Collect 151 Gathering Booster Box 151C")).toBe("CN");
    // '151 Collection' får INTE felflaggas av 151C-regeln.
    expect(detectListingLanguage("Pokémon TCG: 151 Collection Alakazam ex")).toBe("EN");
  });

  it("CJK-skript: Han utan kana = CN, hangul = KR", () => {
    expect(detectListingLanguage("收集癖151 寶可夢集換式卡牌 Booster Box")).toBe("CN");
    expect(detectListingLanguage("포켓몬 카드 게임 Booster Box")).toBe("KR");
    // Kana → JP även om kanji finns med.
    expect(detectListingLanguage("ポケモンカード151 強化拡張パック")).toBe("JP");
  });

  // --- EU-språk (katalogen är EN+JP only). De 6 som läckte in 2026-07-07 sa "*SPANSK*"
  // rakt ut, men de flesta spanska annonser gör INTE det — därför tre lager.
  it("EU-språkord, inkl. språkets eget namn för sig självt", () => {
    expect(detectListingLanguage("Pokémon, Sun & Moon: Lost Thunder, 1 Booster *SPANSK*")).toBe("EU");
    expect(detectListingLanguage("Pokémon, Sun & Moon, 1 Booster *TYSK*")).toBe("EU");
    expect(detectListingLanguage("Pokémon 151 Booster Box Español")).toBe("EU");
    expect(detectListingLanguage("Pokémon 151 Booster Box Castellano")).toBe("EU");
    expect(detectListingLanguage("Pokémon Coffret Dresseur d'Élite Français")).toBe("EU");
    expect(detectListingLanguage("Pokémon Sammelkartenspiel Deutsch")).toBe("EU");
  });

  it("EU-produktord (annonsen skriven på språket, ordet 'spansk' saknas)", () => {
    expect(detectListingLanguage("Pokémon 151 Sobres Booster")).toBe("EU");
    expect(detectListingLanguage("Caja de Entrenador Élite Pokémon 151")).toBe("EU");
    expect(detectListingLanguage("Pokémon Cartas Colección Especial")).toBe("EU");
    expect(detectListingLanguage("Pokémon Bustine Espansione Scarlatto")).toBe("EU");
  });

  it("EU-lokaliserade setnamn (butiken skriver engelsk säljtext, spanskt setnamn)", () => {
    expect(detectListingLanguage("Pokémon Destinos Paldeanos Booster Box")).toBe("EU");
    expect(detectListingLanguage("Pokémon Escarlata y Púrpura Booster Box")).toBe("EU");
    expect(detectListingLanguage("Pokémon Evoluciones Prismáticas ETB")).toBe("EU");
    expect(detectListingLanguage("Pokémon Karmesin und Purpur Booster Display")).toBe("EU");
    expect(detectListingLanguage("Pokémon Écarlate et Violet Coffret")).toBe("EU");
  });

  it("EU-landskoder — men BARA i avgränsad form", () => {
    expect(detectListingLanguage("Pokémon 151 Booster Bundle (SP)")).toBe("EU");
    expect(detectListingLanguage("Pokémon Prismatic Evolutions ETB [ESP]")).toBe("EU");
    expect(detectListingLanguage("Pokémon 151 Elite Trainer Box ES-version")).toBe("EU");
  });

  // DEN FARLIGA RIKTNINGEN: att blockera ENGELSKA produkter vore värre än att släppa
  // igenom en spansk. Varje rad här är en riktig engelsk titel som INTE får bli EU.
  it("FALSKPOSITIV-VAKT: riktiga engelska titlar förblir EN", () => {
    // "Surging SPArks" innehåller SPA — 3-bokstavskoden måste vara versal + avgränsad.
    expect(detectListingLanguage("Pokémon TCG: Surging Sparks Booster Box")).toBe("EN");
    // De engelska setnamnen ligger nära de spanska/tyska — inget av dem får träffa.
    expect(detectListingLanguage("Prismatic Evolutions Elite Trainer Box")).toBe("EN");
    expect(detectListingLanguage("Paldean Fates Booster Bundle")).toBe("EN");
    expect(detectListingLanguage("Scarlet & Violet 151 Booster Box")).toBe("EN");
    expect(detectListingLanguage("Temporal Forces Booster Box")).toBe("EN");
    expect(detectListingLanguage("Twilight Masquerade Elite Trainer Box")).toBe("EN");
    expect(detectListingLanguage("Destined Rivals Booster Box")).toBe("EN");
    expect(detectListingLanguage("Obsidian Flames Booster Box")).toBe("EN");
    expect(detectListingLanguage("Journey Together Booster Box")).toBe("EN");
    expect(detectListingLanguage("Pokémon Center Elite Trainer Box")).toBe("EN");
    expect(detectListingLanguage("Mega Evolution Booster Display")).toBe("EN");
    // Engelska ord som råkar innehålla landskods-bokstäver.
    expect(detectListingLanguage("Charizard ex Special Collection")).toBe("EN");
    expect(detectListingLanguage("Special Illustration Rare Deluxe Edition")).toBe("EN");
    // BART "SP" = Platinum-erans korttyp "Pokémon SP", inte spanska. Bara "(SP)" räknas.
    expect(detectListingLanguage("Pokémon SP Garchomp C LV.X Promo")).toBe("EN");
    // HITTAD SOM FALSKPOSITIV vid körning mot hela prod-katalogen (22 213 produkter):
    // "ESP" är kortets NAMN. En regel för bart versalt ESP/SPA/DEU blockerade ett
    // äkta engelskt kort → regeln togs bort. Får aldrig återinföras.
    expect(detectListingLanguage("Sabrina's ESP · Gym Heroes 117/132")).toBe("EN");
    expect(detectListingLanguage("Surging Sparks SPA Booster")).toBe("EN");
    // Svenska butikstitlar är INTE ett främmande språk — vi säljer i Sverige.
    expect(detectListingLanguage("Pokémon Kortlek Samlarkort Booster Display")).toBe("EN");
  });

  it("URL-slugen avslöjar språket när titeln inte gör det", () => {
    const url = "https://dragonslair.se/products/pokemon-collect-151-gathering-slim-booster-box-151c-kinesisk-version-copy";
    expect(detectListingLanguage("Random Gathering Box", url)).toBe("CN");
    expect(isBlockedListingLanguage("Random Gathering Box", url)).toBe(true);
    const kr = "https://www.shinycards.se/pokemon/booster-box/pokemon-scarlet-violet-wild-force-booster-box-koreansk";
    expect(isBlockedListingLanguage("Wild Force Booster Box", kr)).toBe(true);
    // Japansk slug blockas inte.
    const jp = "https://speltrollet.se/products/pokemon-scarlet-violet-wild-force-booster-japansk";
    expect(isBlockedListingLanguage("Wild Force Booster", jp)).toBe(false);
    expect(listingCardLanguage("Wild Force Booster", jp)).toBe("JP");
  });
});

/**
 * KINESISKA MARKÖRER SOM SLAPP IGENOM (2026-08-08).
 *
 * Sex kinesiska produkter tog sig in i katalogen via Wave 4-butikerna trots policyn
 * EN+JP. De föll på tre olika hål, och alla tre är stängda nu. Testet finns för att
 * hålla dem stängda — varje rad här är en RIKTIG titel ur produktionskatalogen.
 */
describe("kinesiska markörer (Wave 4-läckan)", () => {
  it("flaggar kinesisk setkod, med versaler eller gemener", () => {
    for (const t of [
      "Pokémon Scarlet & Violet: Chasing Glory Together (CSV10C) Slim Booster Box (CN)",
      "Pokémon Scarlet & Violet: Blade Awakened (csv7C) Jumbo Booster Box (CH)",
      "Pokémon Scarlet & Violet: Dark Crystal Blazing Jumbo Booster Pack (csv5C) (CH)",
    ]) {
      expect(detectListingLanguage(t), t).toBe("CN");
    }
  });

  it("flaggar 'Slim Booster' — formatet finns inte i CM:s katalog alls", () => {
    // MÄTT: 0 träffar på "Slim Booster" bland CM:s 5 006 sealed-produkter. Butikernas
    // egen beskrivning sa "Kinesisk utgåva", men TITELN avslöjade ingenting — därför
    // fångas de på formatordet.
    expect(detectListingLanguage("151 Surprise Slim Booster Box")).toBe("CN");
    expect(detectListingLanguage("151 Surprise Slim Booster Pack")).toBe("CN");
  });

  it("flaggar asiatiska landskoder i parentes", () => {
    expect(detectListingLanguage("Pokémon Booster Box (CN)")).toBe("CN");
    expect(detectListingLanguage("Pokémon Booster Box (CH)")).toBe("CN");
    expect(detectListingLanguage("Pokémon Booster Box (KR)")).toBe("KR");
  });

  it("rör INTE engelska eller japanska produkter", () => {
    // Regressionsvakt: mätt mot hela katalogen träffade de nya mönstren exakt de sex
    // kinesiska raderna och inget annat av 1 856 sealed-produkter.
    for (const t of [
      "Scarlet & Violet: 151 Booster Bundle",
      "151 Ultra-Premium Collection",
      "151: Mini Tin Display",
      "Pokemon Scarlet & Violet: Wild Force Booster Box (Japansk)",
      "Celebrations Elite Trainer Box",
      "Chilling Reign Ice Rider Calyrex Elite Trainer Box",
    ]) {
      expect(["EN", "JP"], t).toContain(detectListingLanguage(t));
    }
  });
});

/**
 * WAVE 5-LÄCKAN (2026-08-13) — 118 blockerade produkter tog sig in på EN NATT.
 *
 * Täckningsrevisionen + wave 5 lät auto-importen skapa 898 katalogprodukter, och
 * 118 av dem var koreanska eller kinesiska. Alla bar språket UTSKRIVET i titeln;
 * detektorn kände bara inte just de formerna:
 *
 *   · Aquitaz taggar allt "(ENG)"/"(JP)"/"(KOR)" → 81 koreanska. Regeln hade "kr".
 *   · Yonko TCG taggar "[S-CHN]"/"[T-CHN]" (Simplified/Traditional) → 37 kinesiska.
 *     Regeln hade "cn|ch|tw|hk", varken "chn" eller hakparentes-prefixet.
 *
 * Varje rad nedan är en RIKTIG produktionstitel ur den kohorten.
 */
describe("wave 5-läckan: (KOR) och [S-CHN]", () => {
  it("flaggar Aquitaz trebokstavskod för koreanska", () => {
    for (const t of [
      "Pokémon Scarlet & Violet: Surging Sparks SV8 Booster Box (KOR)",
      "Pokémon Sword & Shield: Lost Abyss s11 Booster Box (KOR)",
      "Pokémon 151 (sv2a) Booster Pack (KOR)",
      "Pokémon Sword & Shield: Eevee Heroes (S6a) Booster Box (KOR)",
    ]) {
      expect(detectListingLanguage(t), t).toBe("KR");
      expect(isBlockedListingLanguage(t), t).toBe(true);
    }
  });

  it("flaggar Yonkos S-/T-prefixade kinesiska hakparenteser", () => {
    for (const t of [
      "[S-CHN] Pokémon BOOSTERPACK - Shining Synergy: Summon (CSM2c)",
      "[S-CHN] Pokémon Display Bundle - Vivid Portrayals (CS2a, CS2b)",
      "[T-CHN] Pokémon Blister - Glory of Team Rocket - Collector's Set (SV10F)",
      "[S-CHN] Pokemon - Trainer Tin (CSL)",
      "[S-CHN] Pokémon Blind Box - Collect 151 Hope Tin",
    ]) {
      expect(detectListingLanguage(t), t).toBe("CN");
      expect(isBlockedListingLanguage(t), t).toBe(true);
    }
  });

  it("släpper fortfarande igenom butikernas EN/JP-taggar", () => {
    // Samma butiker, samma taggformat — bara språket skiljer. Fälls någon av de här
    // har regeln blivit för bred och tystar två helt lagliga sortiment.
    for (const t of [
      "Pokémon Scarlet & Violet: Zebstrica Destined Rivals Blisters (3 Pack) (ENG)",
      "Pokémon Mega Evolution: Mega Evolution 3-Pack Blisters (Golduck) (ENG)",
      "Pokémon Sword & Shield: Crown Zenith Premium Art Galarian Articuno Big Tin (ENG)",
    ]) {
      expect(detectListingLanguage(t), t).toBe("EN");
    }
    for (const t of [
      "[JP] Pokémon BOOSTERPACK - Lost Abyss (S11)",
      "Pokémon Sword & Shield: Blue Sky Stream Booster Pack (JP)",
      "Pokémon Scarlet & Violet: Paradise Dragona Booster Box (JP)",
    ]) {
      expect(detectListingLanguage(t), t).toBe("JP");
      expect(isBlockedListingLanguage(t), t).toBe(false);
    }
  });

  it("MÄTT: de nya formerna rör inte en enda av katalogens äldre titlar", () => {
    // Sonderingen 2026-08-13 körde båda mönstren mot alla 31 216 produkter som fanns
    // FÖRE wave 5: noll träffar. De här raderna är de närmaste grannarna i katalogen —
    // strängar som INNEHÅLLER bokstäverna men inte som avgränsad språkkod.
    for (const t of [
      "Scarlet & Violet: Surging Sparks Booster Bundle",
      "Champion's Path Elite Trainer Box",
      "Kanto Power Mini Tin",
      "Chilling Reign (CRE) Booster Pack",
      "Sword & Shield: Astral Radiance Trainer Box",
      "Pokémon GO Premium Collection (Radiant Eevee)",
    ]) {
      expect(isBlockedListingLanguage(t), t).toBe(false);
    }
  });
});
