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
import { formatPercent, formatPrice } from "@/lib/format";

/** Turkos signaturaccent (`holo.cyan` = #2dd4bf) som heltal, för embed-kanten. */
const BRAND_COLOR = 0x2dd4bf;

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
}

/**
 * Läser konfigurationen ur env. `DISCORD_RESTOCK_CHANNELS` är JSON:
 *   {"default":"123",
 *    "sets":{"Prismatic Evolutions":"456"},
 *    "series":{"Scarlet & Violet":"789","Mega Evolution":"012"},
 *    "languages":{"JP":"345"},
 *    "prices":"678"}
 * `sets` är valfri och vinner över `series` (se resolveChannelId). `languages` är
 * valfri och gäller icke-engelska produkter (utan den går de till catch-all).
 * `prices` är valfri och är EN kanal-id (inte en karta) som tar alla
 * prissänkningsinlägg — utan den routas de som påfyllningarna.
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

  if (!defaultChannelId && !Object.keys(setChannels).length && !Object.keys(seriesChannels).length) {
    return null;
  }
  return {
    botToken,
    setChannels,
    seriesChannels,
    languageChannels,
    defaultChannelId,
    priceChannelId,
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
  priceOre: number | null;
  imageUrl: string | null;
  setName: string | null;
  series: string | null;
  /** Produktens språk ("EN"/"JP"). Styr kanalvalet — se resolveChannelId. */
  language?: string | null;
  /** Vår produktsida, när URL:en gick att slå upp i ruttabellen. */
  productUrl: string | null;
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

function clamp(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Ett embed per restock. Länken går till BUTIKEN, inte till oss: den som får larmet
 * ska kunna köra direkt: varan är slutsåld igen om några minuter. Vår produktsida
 * ligger som en egen rad när vi känner igen URL:en.
 */
export function buildRestockEmbed(post: RestockPost) {
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
  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "Butik", value: clamp(post.storeName, MAX_FIELD_VALUE), inline: true },
    { name: "Pris", value: formatPrice(post.priceOre), inline: true },
  ];
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
    title: clamp(priceDrop ? `Nytt lägre pris — ${post.title}` : post.title, MAX_TITLE),
    url: post.storeUrl,
    description: priceDrop
      ? `Sänkt från ${formatPrice(post.previousPriceOre)} till ${formatPrice(post.priceOre)} ` +
        `(${formatPercent(-priceDrop.percent)}).`
      : post.preorder
        ? "Går nu att förhandsboka."
        : "Finns i lager igen.",
    color: BRAND_COLOR,
    fields,
    ...(post.imageUrl ? { thumbnail: { url: post.imageUrl } } : {}),
    footer: { text: "Foilio · foilio.se" },
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
    // Prisinlägg kan styras till EN egen kanal — se priceChannelId. Utan den följer de
    // samma routing som påfyllningarna.
    const channelId =
      p.previousPriceOre != null && config.priceChannelId
        ? config.priceChannelId
        : resolveChannelId(p.setName, p.series, config, p.language);
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
        body: JSON.stringify({ embeds: batch.map(buildRestockEmbed) }),
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
  return { sent, postedKeys, failed };
}
