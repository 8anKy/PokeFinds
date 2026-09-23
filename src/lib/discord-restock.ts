/**
 * Restock-larm till Discord: routing till kanal per SERIE + inläggsformat + utskick.
 *
 * ⛔ SKILD FRÅN `@/lib/discord.ts` MED FLIT, och beroende av en EGEN spak
 * (`DISCORD_RESTOCK_ENABLED`) — inte av `DISCORD_ENABLED`. De två sakerna har olika
 * juridisk tyngd: rollhanteringen behandlar PERSONUPPGIFTER (Discord-id kopplat till
 * ett konto hos oss) och ligger mörklagd tills integritetspolicyn är granskad, medan
 * ett restock-inlägg bara är produktdata i en publik kanal. Att låta den senare hänga
 * på den förras flagga hade blockerat en ofarlig funktion bakom en juristfråga den
 * inte har något med att göra — och, värre, gjort det frestande att slå på
 * `DISCORD_ENABLED` för tidigt.
 *
 * Delar BARA 429-hanteringen (`discordFetch`) med rollmodulen.
 *
 * KANALVAL = SERIE, inte set (mätt 2026-08-11 på 14 dygns RestockEvent):
 * 171 restocks fördelade på 40 DISTINKTA set, där 15 av dem delar på ~1 inlägg/dygn.
 * En kanal per set hade alltså gett ett trettiotal döda kanaler. På SERIE blir det
 * sju grupper med läsbar volym: Mega Evolution 7,0/dygn · Scarlet & Violet 3,6/dygn ·
 * resten under 0,4/dygn. 7 % av restockarna saknar set helt (nya förhandsboxar får sin
 * etikett inom ≤24 h av sealed-set-label) → catch-all-kanalen är obligatorisk, inte
 * en artighet.
 */
import { discordFetch } from "@/lib/discord";
import { buyLink } from "@/lib/cart-url";
import { formatPercent, formatPrice } from "@/lib/format";
import { msrpDelta } from "@/lib/msrp";
import type { StoreStock } from "@/scrapers/types";

/** Turkos signaturaccent (`holo.cyan` = #2dd4bf) som heltal, för embed-kanten. */
const BRAND_COLOR = 0x2dd4bf;
/**
 * Kantfärg när rek. pris är känt: grön på/under, röd över. Discord kan inte färga
 * löpande text i ett embed, så "procenten blir grön/röd" (ägarönskan 2026-09-21)
 * bärs av TVÅ saker: kanten OCH en 🟢/🔴 framför talet — mobilklienten visar kanten
 * smalt, så emojin är det som faktiskt läses där.
 */
const GOOD_PRICE_COLOR = 0x22c55e;
const BAD_PRICE_COLOR = 0xef4444;

/** Discords hårda tak. Överskrids något svarar API:t 400 och HELA batchen tappas. */
const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_TITLE = 256;
const MAX_FIELD_VALUE = 1024;

export interface DiscordRestockConfig {
  botToken: string;
  /**
   * SETNAMN → kanal-id, och den vinner över serien. Finns för att enstaka set är stora
   * nog att bära en egen kanal (Prismatic Evolutions ensamt = 91 butiks-URL:er) medan
   * svansen inte är det. Utan det här steget hade man tvingats välja mellan sju
   * seriekanaler eller ~136 setkanaler; nu kan man ha båda delarna där de passar.
   */
  setChannels: Record<string, string>;
  /** Serienamn → kanal-id. Används när setet inte har en egen kanal. */
  seriesChannels: Record<string, string>;
  /**
   * SPRÅK → kanal-id (t.ex. {"JP":"…"} för en japansk kanal). Icke-engelska produkter
   * går HIT eller till catch-all — aldrig till set-/seriekanalerna: japanska set bär
   * samma latinska serienamn som de engelska ("Mega Evolution"), så utan spärren
   * hamnade fyra japanska boxar i EN-seriekanalen (mätt 2026-08-12).
   */
  languageChannels: Record<string, string>;
  /** Catch-all. Utan den postas INGENTING som saknar kanal (fail closed). */
  defaultChannelId: string | null;
  /**
   * EN kanal som tar ALLA prissänkningsinlägg (`"prices":"<id>"`). Valfri: utan den
   * följer prisinläggen samma set-/serie-/språkrouting som påfyllningarna.
   *
   * ⛔ FINNS FÖR ATT VOLYMERNA INTE ÄR JÄMFÖRBARA. Kanalerna bär ~12 påfyllningar per
   * dygn; hur många prissänkningar 42 butiker gör per dygn är OMÄTT (ingen sådan
   * historik finns — lanen har aldrig sparat priser). Blir det tio gånger fler
   * dränker de påfyllningarna, som är det larm folk faktiskt jagar. En egen kanal är
   * spaken för det, och den kräver ingen kodändring — bara ett fält i
   * DISCORD_RESTOCK_CHANNELS.
   */
  priceChannelId: string | null;
  /**
   * EN kanal som tar ALLA butiksvaror (`"stores":"<id>"`) — produkter som bara går att
   * hämta i en fysisk butik (`RestockPost.storeOnly`, se SF-Bok och Webhallens
   * butikssläpp). Valfri: utan den routas de som allt annat och skiljs bara av sin
   * egen rubrik/copy ("Finns bara i butik: …").
   *
   * ⛔ SYFTET ÄR ATT DE ANDRA KANALERNA SKA VARA RENT ONLINE (ägarbeslut 2026-09-22).
   * Ett restock-larm är ett lopp man springer med ett klick; en butiksvara är en
   * bilresa till en hylla som kan vara tom när man kommer fram. Blandas de i samma
   * kanal lär sig läsaren att larmen ibland inte går att agera på, och då tappar
   * ALLA larm sin brådska. Därför en egen kanal — och därför vinner den över både
   * set-, serie-, språk- och priskanalen: "går att köpa nu" är en grövre indelning
   * än vilket set varan tillhör.
   */
  storeChannelId: string | null;
  /**
   * PRO-SPEGEL (ägarbeslut 2026-09-17): kanaler som bara Pro-rollen ser, där samma
   * inlägg postas EN GÅNG TILL men med LÄGG-I-KORGEN-länken (Offer.cartUrl) i stället
   * för butikens produktsida. Korgen är Pro-förmånen; de publika kanalerna får aldrig
   * den. `"pro":"<id>"` = en kanal för allt, `"pro":{default,sets,series,languages}` =
   * full spegling med samma routing som de publika. null = ingen spegel.
   * ⛔ Discord kan inte visa olika länkar för olika medlemmar i SAMMA inlägg — därför
   *    en egen kanal, inte en knapp. Prissänkningar speglas inte (ingen korg att sälja).
   */
  pro: {
    setChannels: Record<string, string>;
    seriesChannels: Record<string, string>;
    languageChannels: Record<string, string>;
    defaultChannelId: string | null;
  } | null;
}

/**
 * Läser konfigurationen ur env. `DISCORD_RESTOCK_CHANNELS` är JSON:
 *   {"default":"123",
 *    "sets":{"Prismatic Evolutions":"456"},
 *    "series":{"Scarlet & Violet":"789","Mega Evolution":"012"},
 *    "languages":{"JP":"345"},
 *    "prices":"678",
 *    "stores":"901"}
 * `sets` är valfri och vinner över `series` (se resolveChannelId). `languages` är
 * valfri och gäller icke-engelska produkter (utan den går de till catch-all).
 * `prices` är valfri och är EN kanal-id (inte en karta) som tar alla
 * prissänkningsinlägg — utan den routas de som påfyllningarna. `stores` är valfri och
 * tar alla butiksvaror (endast i fysisk butik) så att övriga kanaler blir rent online.
 *
 * ⛔ Kanal-id:n är INTE hemligheter (till skillnad från webhook-URL:er, som är rena
 * bärartokens — vem som helst med URL:en kan posta i kanalen). Därför bot-token +
 * kanal-id i stället för N webhookar: EN hemlighet som redan finns, och resten är
 * konfiguration som får ligga öppet i ett publikt repo.
 *
 * ⛔ Läser env vid ANROPET, aldrig på modulnivå — samma skäl som `discordBotConfig()`:
 * Railway bygger utan runtime-env, så ett modulnivå-värde hade frusit till "avstängt".
 */
export function discordRestockConfig(): DiscordRestockConfig | null {
  if (process.env.DISCORD_RESTOCK_ENABLED !== "true") return null;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return null;

  const raw = process.env.DISCORD_RESTOCK_CHANNELS;
  if (!raw) return null;
  let parsed: {
    default?: unknown;
    sets?: unknown;
    series?: unknown;
    languages?: unknown;
    prices?: unknown;
    stores?: unknown;
    pro?: unknown;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    console.error("[discord-restock] DISCORD_RESTOCK_CHANNELS är inte giltig JSON — inget postas.");
    return null;
  }

  const readMap = (value: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) out[normalizeChannelKey(k)] = v.trim();
      }
    }
    return out;
  };

  const setChannels = readMap(parsed.sets);
  const seriesChannels = readMap(parsed.series);
  const languageChannels = readMap(parsed.languages);
  const defaultChannelId =
    typeof parsed.default === "string" && parsed.default.trim() ? parsed.default.trim() : null;
  const priceChannelId =
    typeof parsed.prices === "string" && parsed.prices.trim() ? parsed.prices.trim() : null;
  const storeChannelId =
    typeof parsed.stores === "string" && parsed.stores.trim() ? parsed.stores.trim() : null;

  if (!defaultChannelId && !Object.keys(setChannels).length && !Object.keys(seriesChannels).length) {
    return null;
  }

  let pro: DiscordRestockConfig["pro"] = null;
  if (typeof parsed.pro === "string" && parsed.pro.trim()) {
    pro = { setChannels: {}, seriesChannels: {}, languageChannels: {}, defaultChannelId: parsed.pro.trim() };
  } else if (parsed.pro && typeof parsed.pro === "object") {
    const o = parsed.pro as { default?: unknown; sets?: unknown; series?: unknown; languages?: unknown };
    const candidate = {
      setChannels: readMap(o.sets),
      seriesChannels: readMap(o.series),
      languageChannels: readMap(o.languages),
      defaultChannelId: typeof o.default === "string" && o.default.trim() ? o.default.trim() : null,
    };
    if (candidate.defaultChannelId || Object.keys(candidate.setChannels).length || Object.keys(candidate.seriesChannels).length) {
      pro = candidate;
    }
  }

  return {
    botToken,
    setChannels,
    seriesChannels,
    languageChannels,
    defaultChannelId,
    priceChannelId,
    storeChannelId,
    pro,
  };
}

/** Set- och serienamn jämförs skiftlägesokänsligt och utan kantmellanslag. */
export function normalizeChannelKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Vilken kanal ett larm hör hemma i: SET före SERIE före catch-all.
 * `null` = posta inte alls.
 *
 * Ordningen är hela poängen — den specifika regeln måste slå den generella, annars
 * kunde en setkanal aldrig ta emot något (allt hade fastnat i seriekanalen ovanför).
 *
 * ⛔ ICKE-ENGELSKA PRODUKTER GÅR ALDRIG VIA SET/SERIE (mätt 2026-08-12): japanska
 * set bär samma latinska serienamn som de engelska — "Ninja Spinner (M4)" har serien
 * "Mega Evolution" — så fyra japanska boxar landade i EN-seriekanalen. De routas till
 * språkkanalen (`languages` i konfigurationen) eller catch-all. `language` saknas i
 * äldre cachade ruttabeller → tolkas som EN (oförändrat beteende tills ny export).
 *
 * ⛔ FAIL CLOSED: utan träff OCH utan catch-all returneras null i stället för att
 * välja "någon" kanal. Ett larm i fel kanal är värre än inget larm — det lär
 * medlemmarna att kanalindelningen inte betyder något.
 */
export function resolveChannelId(
  setName: string | null | undefined,
  series: string | null | undefined,
  config: Pick<
    DiscordRestockConfig,
    "setChannels" | "seriesChannels" | "languageChannels" | "defaultChannelId"
  >,
  language?: string | null
): string | null {
  const lang = language ? normalizeChannelKey(language) : "en";
  if (lang !== "en") {
    return config.languageChannels[lang] ?? config.defaultChannelId;
  }
  if (setName) {
    const hit = config.setChannels[normalizeChannelKey(setName)];
    if (hit) return hit;
  }
  if (series) {
    const hit = config.seriesChannels[normalizeChannelKey(series)];
    if (hit) return hit;
  }
  return config.defaultChannelId;
}

/**
 * Vilken kanal ETT FÄRDIGT INLÄGG hamnar i — hela routingdomen på ett ställe, ren och
 * testbar. `postRestocks` gör inget eget val; den grupperar bara på svaret härifrån.
 *
 * Ordningen är en rangordning av hur GROVT beslutet är för läsaren:
 *  1. BUTIKSVARA (`stores`) — "går det att köpa härifrån soffan?" är en grövre fråga
 *     än vilket set varan tillhör, och hela poängen med kanalen är att de övriga ska
 *     vara rent online. Gäller därför även en prissänkning på en butiksvara.
 *  2. PRISSÄNKNING (`prices`) — volymen är omätt och får inte dränka påfyllningarna.
 *  3. Set → serie → språk → catch-all (`resolveChannelId`).
 *
 * `null` = posta inte alls (fail closed, se resolveChannelId).
 */
export function resolveRestockChannelId(
  post: Pick<RestockPost, "setName" | "series" | "language" | "storeOnly" | "previousPriceOre">,
  config: Pick<
    DiscordRestockConfig,
    | "setChannels"
    | "seriesChannels"
    | "languageChannels"
    | "defaultChannelId"
    | "priceChannelId"
    | "storeChannelId"
  >
): string | null {
  if (post.storeOnly === true && config.storeChannelId) return config.storeChannelId;
  if (post.previousPriceOre != null && config.priceChannelId) return config.priceChannelId;
  return resolveChannelId(post.setName, post.series, config, post.language);
}

export interface RestockPost {
  /**
   * State-nyckeln (`butik\turl`). Bokföring, inte innehåll — den följer med så att
   * BARA faktiskt postade larm stämplas i cooldown-kartan. Se `postRestocks`.
   */
  key: string;
  /** Butikens annonstitel (eller katalogtiteln när URL:en är känd). */
  title: string;
  storeName: string;
  /** Butikens produktsida — alltid känd, det är den man ska klicka på. */
  storeUrl: string;
  /**
   * Lägg-i-korgen-länk (Shopify/Woo, src/lib/cart-url.ts). Embeddens titel-länk går
   * HIT när den finns — restock är ett lopp, och ett klick ska lämna läsaren med varan
   * i korgen (ägarbeslut 2026-09-17). null = butikens produktsida som förut.
   */
  cartUrl?: string | null;
  priceOre: number | null;
  /**
   * Rekommenderat pris i öre ur ruttabellen (`Product.msrpOre` eller kategoridefault,
   * `src/lib/msrp.ts`). Satt ⇒ inlägget visar avvikelsen; saknas ⇒ ingenting, aldrig
   * en gissning. Följer bara med när URL:en har en rutt — en okänd SKU har inget.
   */
  msrpOre?: number | null;
  /**
   * true = butiksvara: går bara att köpa/reservera i butikens fysiska butik
   * (SF-Bok, Webhallens butikssläpp). Lagerdomen är oförändrad — det här är
   * etiketten som skiljer "beställ nu" från "åk dit".
   */
  storeOnly?: boolean;
  /**
   * Hur mycket som står i de fysiska butikerna (`StoreStock`). Visas bara på
   * butiksvaror — det är TALET som avgör om resan är värd att göra.
   * ⛔ `stores` är ett ANTAL butiker, aldrig VILKA: Webhallens saldon ligger på
   *    namnlösa id:n och det finns ingen publik uppslagning (probat 2026-09-22).
   */
  storeStock?: StoreStock | null;
  /**
   * Butiksinlägg för en vara som SAMTIDIGT går att beställa online (butiksspåret,
   * `restock-feed-events.ts`). Copyn säger då "finns även i butik" i stället för
   * "går inte att köpa i webbutiken".
   */
  alsoOnline?: boolean;
  /**
   * Ingen larm-hit för det här inlägget: appen är redan larmad (eller behöver inte
   * larmas) via onlinespåret. Discord-inlägget går ut som vanligt.
   */
  noHit?: boolean;
  imageUrl: string | null;
  setName: string | null;
  series: string | null;
  /** Produktens språk ("EN"/"JP"). Styr kanalvalet — se resolveChannelId. */
  language?: string | null;
  /** Vår produktsida, när URL:en gick att slå upp i ruttabellen. */
  productUrl: string | null;
  /**
   * Katalogproduktens slug ur rutten. Det som gör inlägget till en LARM-HIT
   * (`src/lib/restock-hits.ts`): utan produkt finns inga bevakare att larma.
   */
  productSlug?: string | null;
  /**
   * Lagerövergången bakom inlägget, som lanen såg den ("ABSENT" = fanns inte i förra
   * feeden). Följer med till appen så att larmets copy och RestockEvent-raden bär
   * samma från/till som Discord-inlägget. Saknas på prisinlägg.
   */
  transition?: { from: string; to: string };
  /**
   * Reservlänk till katalogen filtrerad på SETET, för inlägg där vi inte känner igen
   * butikens URL och därför inte har någon produktsida. Används bara när
   * `productUrl` saknas — en setlänk kan varken bli fel eller landa tomt, till
   * skillnad från ett fritextsök på butikens titel (se restock-feed-events.ts).
   */
  setUrl?: string | null;
  /** PREORDER-övergång får egen rubrik — det är ett annat besked än en påfyllning. */
  preorder?: boolean;
  /**
   * Priset FÖRE sänkningen (öre). Satt ⇒ inlägget är ett PRISLARM, inte en påfyllning:
   * varan har stått i lager hela tiden, det är priset som är nyheten.
   *
   * ⛔ RUBRIKEN SÄGER "NYTT LÄGRE PRIS", ALDRIG "LÄGSTAPRIS". Talet här är priset vi
   * SÅG SENAST i butikens feed, inte ett historiskt lägsta — den historiken bor i
   * databasen, som den här lanen aldrig får röra. "Lägstapris" hade varit ett
   * påstående vi inte kan belägga, och ett obelagt påstående om pris är precis det
   * katalogens övriga regler finns för att förhindra.
   */
  previousPriceOre?: number | null;
}

/**
 * "22 ex i 1 butik", "36 ex i 6 butiker", "minst 50 ex i 2 butiker", "10 ex".
 * `null` = säg ingenting alls.
 *
 * ⛔ TRE UTFALL, INTE TVÅ. `units: null` (källan säger bara "finns i butik") och
 *    `stores: null` (SF-Bok bryter inte ner per butik) är OKÄNT, inte noll — och ett
 *    "0 ex" bredvid ett larm om att varan FINNS är en självmotsägelse i en publik
 *    kanal. Okänt ⇒ raden uteblir hellre.
 * ⛔ `capped` ⇒ "minst": talet är Webhallens visningstak, inte butikens saldo.
 */
export function formatStoreStock(stock: StoreStock | null | undefined): string | null {
  if (!stock) return null;
  const units = typeof stock.units === "number" && stock.units > 0 ? stock.units : null;
  const stores = typeof stock.stores === "number" && stock.stores > 0 ? stock.stores : null;
  if (units == null && stores == null) return null;
  const unitPart =
    units == null ? null : `${stock.capped ? "minst " : ""}${units} ex`;
  const storePart = stores == null ? null : `${stores} ${stores === 1 ? "butik" : "butiker"}`;
  if (unitPart && storePart) return `${unitPart} i ${storePart}`;
  return unitPart ?? `Finns i ${storePart}`;
}

/**
 * Hur många namngivna butiker som ryms i fältet innan resten blir en "+N fler"-rad.
 * Fyra rader är vad som får plats utan att embedden blir en vägg; resten summeras.
 */
const MAX_STORE_LINES = 4;

/**
 * Butikerna med saldo, en per rad: "Bredden (InfraCity), Upplands Väsby · 14 ex".
 * `null` när källan inte namnger dem — då står sammanfattningen ensam.
 *
 * ⛔ SUMMAN STÅR KVAR PÅ FÖRSTA RADEN även när listan kapas. Utan den läser fyra
 *    rader som hela sanningen, och den som har närmast till butik nr 5 åker ingenstans.
 */
export function formatStoreLocations(stock: StoreStock | null | undefined): string | null {
  const locations = stock?.locations ?? [];
  if (!locations.length) return null;
  const head = locations.slice(0, MAX_STORE_LINES);
  const rest = locations.slice(MAX_STORE_LINES);
  const lines = head.map((l) => `${l.label} · ${l.capped ? "minst " : ""}${l.units} ex`);
  if (rest.length) {
    const restUnits = rest.reduce((sum, l) => sum + l.units, 0);
    lines.push(`+${rest.length} ${rest.length === 1 ? "butik till" : "butiker till"} · ${restUnits} ex`);
  }
  return lines.join("\n");
}

/**
 * "Webhallen Bredden (InfraCity), Upplands Väsby" när varan står i EN namngiven
 * butik, annars "Webhallens fysiska butiker". Se kommentaren vid anropet.
 */
function storeOnlyWhere(post: RestockPost): string {
  const locations = post.storeStock?.locations ?? [];
  if (locations.length === 1) return `${post.storeName} ${locations[0].label}`;
  return `${post.storeName}s fysiska butiker`;
}

function clamp(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Ett embed per restock. Länken går till BUTIKEN, inte till oss: den som får larmet
 * ska kunna köra direkt: varan är slutsåld igen om några minuter. Vår produktsida
 * ligger som en egen rad när vi känner igen URL:en.
 */
export function buildRestockEmbed(post: RestockPost, opts: { cart?: boolean } = {}) {
  // ⛔ BÅDA TALEN MÅSTE VARA RIKTIGA PRISER. `previousPriceOre` sätts bara av
  //    prisdomen, men embedden byggs också av testläget och av äldre state — och en
  //    nolla i nämnaren hade gett "−Infinity %" i en publik kanal.
  const priceDrop =
    post.previousPriceOre != null &&
    post.previousPriceOre > 0 &&
    post.priceOre != null &&
    post.priceOre > 0 &&
    post.priceOre < post.previousPriceOre
      ? { percent: ((post.previousPriceOre - post.priceOre) / post.previousPriceOre) * 100 }
      : null;
  // Rek. pris-jämförelsen: bara när BÅDA talen är riktiga priser (msrpDelta vaktar).
  const delta = msrpDelta(post.priceOre, post.msrpOre);
  const storeOnly = post.storeOnly === true;
  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "Butik", value: clamp(post.storeName, MAX_FIELD_VALUE), inline: true },
    // Inget "Köp: Online/Endast i butik"-fält (borttaget 2026-09-22, ägarbeslut): kanalen
    // säger det redan (`stores` tar alla butiksvaror), och en butiksvara har dessutom egen
    // rubrik, "Pris i butik", källa och fot.
    { name: storeOnly ? "Pris i butik" : "Pris", value: formatPrice(post.priceOre), inline: true },
  ];
  // Inget "Källa"-fält (borttaget 2026-09-23, ägarbeslut): foten säger redan att
  // butikslagret kan ändras och att man ska ringa innan.
  if (storeOnly) {
    // Saldot SIST bland raderna och på egen full bredd: det är flera rader, och
    // inline hade tryckt ihop butiksnamnen till oläsliga spalter.
    const summary = formatStoreStock(post.storeStock);
    const perStore = formatStoreLocations(post.storeStock);
    if (summary || perStore) {
      fields.push({
        name: "I lager",
        value: clamp(
          summary && perStore ? `**${summary}**\n${perStore}` : (perStore ?? summary ?? ""),
          MAX_FIELD_VALUE
        ),
        inline: false,
      });
    }
  }
  if (delta) {
    fields.push({
      name: "Rek. pris",
      value: clamp(
        `${formatPrice(delta.msrpOre)} · ${delta.verdict === "good" ? "🟢" : "🔴"} ` +
          `${formatPercent(delta.percent)} (${delta.diffOre > 0 ? "+" : ""}${formatPrice(delta.diffOre)})`,
        MAX_FIELD_VALUE
      ),
      inline: true,
    });
  }
  if (post.setName) {
    fields.push({ name: "Set", value: clamp(post.setName, MAX_FIELD_VALUE), inline: true });
  }
  // Bara när det AVVIKER från engelska — ett "Språk: Engelska" på varje rad är brus.
  if (post.language && post.language.toUpperCase() !== "EN") {
    const label = post.language.toUpperCase() === "JP" ? "Japanska" : post.language;
    fields.push({ name: "Språk", value: clamp(label, MAX_FIELD_VALUE), inline: true });
  }
  // ⛔ EN VÄG TILLBAKA TILL OSS I VARJE INLÄGG SOM KAN HA EN. Produktsidan när vi
  // känner igen butikens URL, annars katalogen filtrerad på setet. Fältnamnet skiljer
  // dem åt med flit: "Prishistorik" lovar en prisgraf, och den finns bara på
  // produktsidan — att kalla setlänken samma sak hade varit ett löfte vi inte håller.
  if (post.productUrl) {
    fields.push({
      name: "Prishistorik",
      value: clamp(`[Se på Foilio](${post.productUrl})`, MAX_FIELD_VALUE),
      inline: false,
    });
  } else if (post.setUrl) {
    fields.push({
      name: "Hos oss",
      value: clamp(`[Se hela setet på Foilio](${post.setUrl})`, MAX_FIELD_VALUE),
      inline: false,
    });
  }

  return {
    title: clamp(
      priceDrop
        ? `Nytt lägre pris — ${post.title}`
        : storeOnly
          ? `${post.alsoOnline ? "Finns i butik" : "Finns bara i butik"}: ${post.title}`
          : post.title,
      MAX_TITLE
    ),
    // ⛔ PRODUKTSIDAN I DE PUBLIKA KANALERNA, KORGEN BARA I PRO-SPEGELN (ägarbeslut
    //    2026-09-17): korglänken är Pro-förmånen (push + Pro-kanal). `cartUrl` följer
    //    med posten → hiten → offern, så pushen får den också.
    url: opts.cart ? buyLink(post.cartUrl, post.storeUrl) : post.storeUrl,
    description: priceDrop
      ? `Sänkt från ${formatPrice(post.previousPriceOre)} till ${formatPrice(post.priceOre)} ` +
        `(${formatPercent(-priceDrop.percent)}).`
      : storeOnly
        ? // ⛔ NAMNET BARA NÄR DET ÄR EN ENDA BUTIK, och bara när källan gav oss det.
          //   Står varan i sex butiker är ett namn i rubriken missvisande, och ett
          //   gissat namn skickar folk till fel stad — då säger vi "butikerna" och
          //   låter "I lager"-fältet räkna upp dem.
          `Finns i ${storeOnlyWhere(post)} just nu. ` +
          (post.alsoOnline
            ? "Går även att beställa i webbutiken."
            : "Går inte att köpa i webbutiken, bara på plats.")
        : post.preorder
          ? "Går nu att förhandsboka."
          : "Finns i lager igen.",
    color: delta ? (delta.verdict === "good" ? GOOD_PRICE_COLOR : BAD_PRICE_COLOR) : BRAND_COLOR,
    fields,
    ...(post.imageUrl ? { thumbnail: { url: post.imageUrl } } : {}),
    footer: {
      // ⛔ INGEN UPPDATERINGSTAKT I TEXTEN. Lanen pollar butikerna i olika takt
      //    (restock-poll-interval.ts) och saldot kan dessutom ändras mellan två
      //    pollningar — "uppdateras varje timme" hade varit ett löfte vi inte håller.
      text: storeOnly
        ? "Foilio · Butikslagret kan ändras snabbt — ring butiken innan du åker."
        : "Foilio · foilio.se",
    },
    timestamp: new Date().toISOString(),
  };
}

/** Delar en lista i bitar om högst `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Postar ETT testinlägg i varje konfigurerad kanal, märkt med vilken routingregel som
 * pekar dit. Rör varken feedar eller state.
 *
 * Finns för att uppsättningsfelet är TYST: en bot utan "Send Messages"/"Embed Links",
 * eller ett kanal-id från fel server, upptäcks annars först när en riktig påfyllning
 * inte dyker upp — och då syns det bara i en körningslogg ingen läser. Kör den här
 * efter varje kanaländring; att den märker ut regeln gör att en förväxlad kanal syns
 * direkt i Discord i stället för att upptäckas veckor senare på ett felsorterat larm.
 */
export async function postTestMessages(
  config: DiscordRestockConfig,
  /**
   * Bara den här kanalen (id). Utelämnas → alla konfigurerade kanaler.
   *
   * ⛔ FINNS FÖR ATT TESTET SKA GÅ ATT KÖRA OM UTAN ATT SPAMMA SERVERN. Att lägga
   * till EN kanal, eller rätta rättigheterna i EN kanal, krävde annars ett testinlägg
   * i ALLA — åtta meddelanden att städa bort för att kontrollera ett. Ett test som är
   * obekvämt att köra körs inte, och då är vi tillbaka i det tysta uppsättningsfelet
   * som lät lanen stå still i 14 timmar 2026-08-12.
   */
  onlyChannelId?: string
): Promise<{ ok: string[]; failed: string[] }> {
  const all: { channelId: string; rule: string }[] = [
    ...Object.entries(config.setChannels).map(([k, v]) => ({ channelId: v, rule: `set: ${k}` })),
    ...Object.entries(config.seriesChannels).map(([k, v]) => ({ channelId: v, rule: `serie: ${k}` })),
    ...Object.entries(config.languageChannels).map(([k, v]) => ({ channelId: v, rule: `språk: ${k}` })),
    ...(config.priceChannelId
      ? [{ channelId: config.priceChannelId, rule: "prissänkningar" }]
      : []),
    ...(config.storeChannelId
      ? [{ channelId: config.storeChannelId, rule: "butiksvaror (endast i fysisk butik)" }]
      : []),
    ...(config.defaultChannelId
      ? [{ channelId: config.defaultChannelId, rule: "default (allt utan egen kanal)" }]
      : []),
  ];
  const targets = onlyChannelId ? all.filter((t) => t.channelId === onlyChannelId) : all;
  // ⛔ ETT FILTER SOM INTE TRÄFFAR FÅR INTE SE UT SOM ETT LYCKAT TEST. Utan raden
  //    hade "0 kanaler OK, 0 misslyckades" rapporterats som grönt för ett id som
  //    inte ens står i konfigurationen — dvs precis den tystnad testet finns för.
  if (onlyChannelId && targets.length === 0) {
    return {
      ok: [],
      failed: [
        `kanal-id ${onlyChannelId} finns INTE i DISCORD_RESTOCK_CHANNELS — inget testades`,
      ],
    };
  }

  const ok: string[] = [];
  const failed: string[] = [];
  for (const t of targets) {
    const res = await discordFetch(`/channels/${t.channelId}/messages`, {
      method: "POST",
      authorization: `Bot ${config.botToken}`,
      body: JSON.stringify({
        embeds: [
          {
            title: "Testinlägg från Foilio",
            description:
              `Den här kanalen tar emot restock-larm för **${t.rule}**.\n\n` +
              "Ser du det här är boten rätt kopplad. Inlägget går att radera.",
            color: BRAND_COLOR,
            footer: { text: "Foilio · foilio.se" },
          },
        ],
      }),
    });
    if (res.ok) {
      ok.push(`${t.rule} → ${t.channelId}`);
    } else {
      const body = await res.text().catch(() => "");
      failed.push(`${t.rule} → ${t.channelId}: ${res.status} ${body}`);
    }
  }
  return { ok, failed };
}

/**
 * Postar larmen, grupperade per kanal och buntade tio och tio.
 *
 * Buntningen är inte kosmetisk: Discord rate-limitar per kanal, och ett släpp kan ge
 * ett tiotal restocks i samma körning. Tio embeds i ETT inlägg är en förfrågan i
 * stället för tio, och läser dessutom som en lista i stället för en vägg.
 *
 * Returnerar nycklarna för de larm som FAKTISKT gick ut, plus antalet som NEKADES —
 * anroparen ska göra körningen RÖD på nekade utskick. Mätt behov 2026-08-12: boten
 * förlorade Send Messages i alla sju kanaler och lanen stod tyst i 14 timmar med
 * gröna körningar; enda spåret var en loggrad ingen läser.
 *
 * ⛔ Antalet räcker inte: anroparen stämplar cooldown-kartan med det här utfallet, och
 * stämplar man ett larm som aldrig postades tystas produkten i två timmar på grund av
 * ett fel hos Discord. Ett misslyckat inlägg hoppas alltså (larmet är färskvara — en
 * retry nästa körning vore ett inaktuellt besked) men får INTE räknas som levererat.
 */
export async function postRestocks(
  posts: RestockPost[],
  config: DiscordRestockConfig
): Promise<{ sent: number; postedKeys: string[]; failed: number }> {
  const byChannel = new Map<string, RestockPost[]>();
  for (const p of posts) {
    const channelId = resolveRestockChannelId(p, config);
    if (!channelId) {
      console.warn(
        `[discord-restock] Ingen kanal för set "${p.setName ?? "(saknas)"}" / serie ` +
          `"${p.series ?? "(saknas)"}" — hoppar ${p.title}`
      );
      continue;
    }
    const list = byChannel.get(channelId);
    if (list) list.push(p);
    else byChannel.set(channelId, [p]);
  }

  let sent = 0;
  let failed = 0;
  const postedKeys: string[] = [];
  for (const [channelId, list] of byChannel) {
    for (const batch of chunk(list, MAX_EMBEDS_PER_MESSAGE)) {
      const res = await discordFetch(`/channels/${channelId}/messages`, {
        method: "POST",
        authorization: `Bot ${config.botToken}`,
        body: JSON.stringify({ embeds: batch.map((p) => buildRestockEmbed(p)) }),
      });
      if (res.ok) {
        sent += batch.length;
        for (const p of batch) postedKeys.push(p.key);
        continue;
      }
      // 403 här betyder nästan alltid att boten saknar "Send Messages" i kanalen,
      // 404 att kanal-id:t är fel. Båda är tysta för användaren — därav loggraden.
      failed += batch.length;
      console.error(
        `[discord-restock] Kunde inte posta ${batch.length} larm i kanal ${channelId}: ` +
          `${res.status} ${await res.text().catch(() => "")}`
      );
    }
  }
  // ── PRO-SPEGELN: samma inlägg, korglänk, bara i Pro-kanalerna ────────────────
  // Postas EFTER de publika så en trasig Pro-kanal aldrig håller de publika. Ett
  // nekat Pro-inlägg räknas som `failed` (körningen blir röd — felkonfiguration ska
  // synas) men rör inte `postedKeys`: cooldownen stämplas på det publika utfallet.
  if (config.pro) {
    const byPro = new Map<string, RestockPost[]>();
    for (const p of posts) {
      if (p.previousPriceOre != null) continue; // prissänkningar: ingen korg att sälja
      if (p.storeOnly === true) continue; // butiksvara: det finns ingen korg att lägga i
      if (!postedKeys.includes(p.key)) continue; // bara det som faktiskt gick ut publikt
      const channelId = resolveChannelId(p.setName, p.series, config.pro, p.language);
      if (!channelId) continue;
      const list = byPro.get(channelId);
      if (list) list.push(p);
      else byPro.set(channelId, [p]);
    }
    for (const [channelId, list] of byPro) {
      for (const batch of chunk(list, MAX_EMBEDS_PER_MESSAGE)) {
        const res = await discordFetch(`/channels/${channelId}/messages`, {
          method: "POST",
          authorization: `Bot ${config.botToken}`,
          body: JSON.stringify({ embeds: batch.map((p) => buildRestockEmbed(p, { cart: true })) }),
        });
        if (res.ok) continue;
        failed += batch.length;
        console.error(
          `[discord-restock] Kunde inte posta ${batch.length} Pro-larm i kanal ${channelId}: ` +
            `${res.status} ${await res.text().catch(() => "")}`
        );
      }
    }
  }

  return { sent, postedKeys, failed };
}
