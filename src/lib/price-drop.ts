/**
 * Är en prissänkning i en butiksfeed värd ett Discord-inlägg? Ren funktion, ingen DB.
 *
 * ⛔ FEEDPRISET ÄR INGEN PRISLISTA — DET ÄR EN AVLÄSNING. Domen här finns för att
 * `FeedItem.price` är precis så skör som den ser ut:
 *  · **Shopify utan variantsplit rapporterar BILLIGASTE KÖPBARA VARIANTEN**
 *    (`shopify-adapter.ts`), dvs ett "från"-pris som rör sig när en variant tar slut
 *    eller kommer tillbaka. En sänkning där är sann ("du kan köpa den billigare nu")
 *    men den är inte alltid en prissänkning butiken GJORT.
 *  · **Fem kopior av `parseSekPrice` strippar inte punkt-tusental.** Byter en butik
 *    tema från "2 999,00 kr" till "2.999,00 kr" börjar adaptern tyst rapportera
 *    300 öre — ett tal som passerar `price > 0` och läser som årets fynd.
 *  · **Shopifys svenska marknad hänger på `localization=SE`-cookien.** Slutar den
 *    bita serveras utländsk marknad EX MOMS (uppmätt: 55,20 = 69/1,25), dvs ~20 %
 *    "sänkning" på ALLT hos den butiken samtidigt.
 *  · **Webhallens pris kommer ur det släpande sökindexet** och skrivs ALDRIG om av
 *    live-kollen (bara lagerstatusen gör det).
 *
 * Därav tre spakar utöver golvet: ett TAK (för stort fall = troligare vår parser än
 * deras pris), en BURST-gräns per butik och hämtning (alla faller samtidigt = troligare
 * valuta/marknad än 30 enskilda prissänkningar), och en COOLDOWN med undantag för
 * ett YTTERLIGARE fall (annars postar en butik som pendlar 559 ⇄ 450 varje varv).
 *
 * ⛔ INGEN AV GRÄNSERNA ÄR MÄTT PÅ VÅR EGEN TRAFIK ÄN — de är satta i underkant med
 * flit. Varje avvisad kandidat räknas och namnges i körningsloggen (`priceSamples`),
 * så första dygnet i drift är mätningen. Justera på de talen, inte på magkänsla.
 */

/** Gränserna. Byggs ur env vid ANROPET — aldrig på modulnivå (Railway/Actions-regeln). */
export interface PriceDropPolicy {
  /** Minsta fall i PROCENT av det gamla priset. */
  minPercent: number;
  /** Minsta fall i ÖRE. Båda måste uppfyllas — 5 % av 40 kr är brus. */
  minOre: number;
  /** Största fall vi tror på. Över det: troligare en parser-/valutamiss än ett pris. */
  maxPercent: number;
  /** Max antal prisinlägg per butik och hämtning. Fler = systemfel, inte 30 reor. */
  maxPerStore: number;
  /** Timmar innan samma URL får ett nytt prisinlägg på samma nivå. */
  cooldownHours: number;
}

/**
 * `null` = funktionen är avstängd (`DISCORD_PRICE_DROPS_ENABLED != "true"`).
 * Egen spak med flit: prisinlägg är mycket vanligare än påfyllningar, och den som
 * ser kanalerna drunkna ska kunna stänga av EN sak utan att tysta restock-larmen.
 */
export function pricePolicy(): PriceDropPolicy | null {
  // ⛔ TOM STRÄNG ÄR "OSATT", INTE "AV". Workflowet skickar `${{ vars.X }}`, och en
  //    repo-variabel som inte finns blir en TOM sträng i miljön — inte `undefined`.
  //    Med ett rakt `!== "true"` hade själva raden i workflowet stängt av funktionen,
  //    tyst, för alla som inte också hann skapa variabeln. Samma fälla som
  //    DISCORD_RESTOCK_STORES en gång gick i.
  const flag = process.env.DISCORD_PRICE_DROPS_ENABLED?.trim();
  if (flag && flag !== "true") return null;
  const num = (name: string, fallback: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    minPercent: num("DISCORD_PRICE_DROP_MIN_PERCENT", 5),
    minOre: num("DISCORD_PRICE_DROP_MIN_ORE", 1000),
    maxPercent: num("DISCORD_PRICE_DROP_MAX_PERCENT", 60),
    maxPerStore: num("DISCORD_PRICE_DROP_MAX_PER_STORE", 8),
    cooldownHours: num("DISCORD_PRICE_DROP_COOLDOWN_HOURS", 12),
  };
}

/** Priset vi SENAST postade om för en URL, och när. Anti-pendling. */
export interface PricePostMemory {
  /** posted price, öre */
  p: number;
  /** tidpunkt, ms */
  t: number;
}

export type PriceDropVerdict =
  | { post: true; dropOre: number; percent: number }
  | { post: false; reason: PriceRejectReason };

export type PriceRejectReason =
  /** Inget att jämföra med (första gången vi ser URL:en i lager). */
  | "no-baseline"
  /** ⛔ 0 kr är inget pris — samma invariant som priceOreFromEur(). */
  | "no-price"
  /** Priset steg eller stod still. */
  | "not-cheaper"
  /** Under procent- eller öresgolvet. */
  | "too-small"
  /** Över taket — troligare en parser-/valutamiss än en riktig sänkning. */
  | "implausible"
  /** Vi postade nyss om samma prisnivå. */
  | "cooldown";

/**
 * Domen om EN URL:s prisförändring.
 *
 * ⛔ `previousOre` är det pris vi SÅG SENAST, inte ett historiskt lägsta. Vi kallar
 * därför inlägget "nytt lägre pris", aldrig "lägstapris": lanen har ingen prishistorik
 * (den bor i databasen, som den här lanen aldrig får röra) och kan alltså inte veta
 * om priset varit lägre förut. Ett påstående vi inte kan belägga är sämre än inget.
 */
export function judgePriceDrop(
  previousOre: number | null | undefined,
  currentOre: number | null | undefined,
  lastPosted: PricePostMemory | null | undefined,
  now: Date,
  policy: PriceDropPolicy
): PriceDropVerdict {
  // ⛔ 0 KR ÄR INGET PRIS, åt båda hållen. Ett nollat gammalt pris hade gett ett
  //    oändligt "fall" och ett nollat nytt pris hade postat "0 kr" som ett fynd.
  if (!isPrice(currentOre)) return { post: false, reason: "no-price" };
  if (!isPrice(previousOre)) return { post: false, reason: "no-baseline" };

  const dropOre = previousOre - currentOre;
  if (dropOre <= 0) return { post: false, reason: "not-cheaper" };

  const percent = (dropOre / previousOre) * 100;
  if (percent < policy.minPercent || dropOre < policy.minOre) {
    return { post: false, reason: "too-small" };
  }
  if (percent > policy.maxPercent) return { post: false, reason: "implausible" };

  // Pendlingsspärren: inom cooldown-fönstret krävs ett YTTERLIGARE fall under den
  // nivå vi redan postat. Utan undantaget hade en riktig andra sänkning tystats i
  // ett halvt dygn; utan cooldownen hade 559 ⇄ 450 postats varje varv.
  if (lastPosted && now.getTime() - lastPosted.t < policy.cooldownHours * 3600_000) {
    const needed = lastPosted.p * (1 - policy.minPercent / 100);
    if (currentOre > needed) return { post: false, reason: "cooldown" };
  }

  return { post: true, dropOre, percent };
}

function isPrice(ore: number | null | undefined): ore is number {
  return typeof ore === "number" && Number.isFinite(ore) && ore > 0;
}
