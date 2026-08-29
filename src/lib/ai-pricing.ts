/**
 * VAD EN AI-FUNKTION KOSTAR — EN PRISLISTA, INTE EN GISSNING (2026-08-14).
 *
 * Admin-panelen visar hur mycket varje användare kostar per funktion. Talet får
 * komma från TRE saker, aldrig något annat: leverantörens PUBLICERADE pris per
 * miljon tokens, det VERKLIGA tokentalet som API:t rapporterade för just det
 * anropet, och — bara där en rad säger det själv — ett pris LÖST UR EN VERKLIG
 * FAKTURA. Ingen schablon per skanning, ingen uppskattning ur ett medelvärde,
 * ingen "rimlig" avrundning uppåt — samma regel som gäller kortpriserna i övriga
 * appen (inga fabricerade siffror).
 *
 * ⛔ **DEN TREDJE KÄLLAN ÄR DEN FARLIGASTE, OCH RUBRIKEN FÖRBJÖD DEN FÖRUT.**
 *    Fram till 2026-08-29 stod här "bara … två saker: leverantörens PUBLICERADE
 *    pris … ingen uppskattning ur ett medelvärde" — samtidigt som tabellen nedan
 *    bar ett kalibrerat inpris. En regel som koden själv bryter mot slutar vara
 *    en regel: nästa läsare rättar antingen texten eller talet, och båda vägarna
 *    är gissningar. Kalibrering är TILLÅTEN, men villkoret är att raden bär sin
 *    HÄRLEDNING: fakturans belopp, tokenmängden den mättes mot, växelkursen och
 *    dess osäkerhet, OSÄKERHETSBANDET, residualen och datumet. Går talet inte att
 *    räkna fram ur kommentaren är det ingen kalibrering utan en åsikt.
 *
 * ⛔ **ETT SAKNAT TOKENTAL ÄR INTE NOLL KRONOR.** `costMicroUsd()` returnerar
 *    `null` när modellen är okänd eller tokentalen saknas, och anroparen räknar
 *    raden som OMÄTT i stället för gratis. Historiska rader (före 2026-08-14)
 *    bär inga tokental alls; en nolla där hade fått en tung användare att se
 *    gratis ut, vilket är precis fel håll för en kostnadsvy. Samma familj som
 *    "0 kr är inget pris" i exchange-rate.ts.
 *
 * ⛔ **PRISERNA ÄR FÄRSKVARA.** De står här som konstanter med datum, och de
 *    ändras när leverantören ändrar sin prislista — inte när någon gissar.
 *    `AI_PRICE_OVERRIDES` (env, JSON) finns för att kunna rätta ett pris i drift
 *    utan deploy; utan den hade en prisändring krävt en release för att sluta
 *    ljuga. ⛔ En KALIBRERING hör däremot hemma i tabellen nedan, inte i
 *    env-variabeln: en override bär varken datum eller källa, och ett tal utan
 *    proveniens är bara en annan gissning.
 *
 * ⛔ **DET HÄR ÄR DEN ENDA PRISLISTAN — DET FANNS TVÅ (rättat 2026-08-29).**
 *    `scripts/scanner-telemetry.ts` bar en EGEN tabell, nycklad på LEVERANTÖR
 *    ("gemini": 0,20/0,80) medan den här är nycklad på MODELL
 *    ("gemini-3.1-flash-lite": 0,25/1,50). Samma anrop kostade alltså olika
 *    mycket beroende på vem som frågade: adminpanelen läste den här filen,
 *    telemetrin sin egen. MÄTT mot hela ScannerJob-historiken 2026-08-29
 *    (1 130 anrop, 4 206 534 in- och 63 663 ut-tokens): $1,147 mot $0,892,
 *    dvs **28,6 % isär**. Telemetrin importerar numera härifrån; lägg aldrig
 *    tillbaka en andra tabell, och nyckla aldrig på leverantör — samma adapter
 *    kör modeller som skiljer en faktor tre.
 *
 * ⛔ **TVÅ SORTERS TAL I SAMMA TABELL, OCH DE FÅR INTE FÖRVÄXLAS.** Ett pris här
 *    är antingen ett LISTPRIS (avläst hos leverantören) eller KALIBRERAT mot en
 *    verklig faktura. Fakturan vinner alltid — men bara för den del av notan den
 *    faktiskt kan se, och bara så länge någon läser en ny. Varje kalibrerad rad
 *    bär därför datum, uträkning och residual i sin kommentar.
 *
 * ⛔ **MODELLNAMNET MÅSTE FÖLJA MED IN I DATABASEN.** Kostnaden räknas i
 *    efterhand ur sparade rader, så en rad som bara bär tokental kan inte
 *    prissättas — vi vet inte vilken modell som kördes. Därför skriver både
 *    skannern och graderingen `model` bredvid `usage`.
 */

/** Pris per miljon tokens, i US-dollar. */
export interface ModelPrice {
  /** USD per 1 000 000 input-tokens. */
  inputPerMTok: number;
  /** USD per 1 000 000 output-tokens. */
  outputPerMTok: number;
}

/**
 * Pris per miljon tokens (USD). LISTPRIS där inget annat står — avlästa
 * 2026-08-14. Avviker en rad från listpriset står källan, datumet och
 * uträkningen i radens egen kommentar (se `gemini-3.1-flash-lite`).
 *
 * Nycklarna är modell-id:n EXAKT som de skrivs i env/koden
 * (`SCANNER_MODEL`, `GRADING_MODEL_*`), eftersom det är den strängen som
 * hamnar i `ScannerJob.result.model` / `GradingJob.modelUsed`.
 *
 * ⚠️ Sonnet 5 har ett introduktionspris ($2/$10) t.o.m. 2026-08-31. Här står
 * ORDINARIE pris med flit: en kostnadsvy ska hellre överskatta än underskatta,
 * och intropriset försvinner om två veckor. Vill man mäta det faktiska utfallet
 * under intro-perioden: sätt `AI_PRICE_OVERRIDES`.
 */
/**
 * DET HÄRLEDBARA BANDET FÖR `gemini-3.1-flash-lite`s INPRIS (2026-08-29).
 *
 * ⛔ **EXPORTERAT FÖR ATT DET FINNS ETT TEST SOM VAKTAR DET — OCH EN KOPIA DRIVER
 * ISÄR TYST.** Samma läxa som `ART_TRUST_*` (kopierat i ett mätskript och redan
 * urdrivet) och som den andra prislistan i `scanner-telemetry.ts`, som gav samma
 * anrop två priser 28,6 % isär. Bandet och priset ska ändras i samma uttryck.
 *
 * Bredden är inte statistisk osäkerhet utan en OFULLSTÄNDIG NÄMNARE: fakturadagen
 * 2026-08-02 fanns anrop utan tokental (`costModel` skrevs först 2026-08-14).
 *  · `high` = alla odiagnostiserade anrop var GRATIS (bilden avgjorde) ⇒ nämnaren
 *    är den vi känner ⇒ högsta inpris fakturan kan bära. Det är också den enda
 *    punkten som går att HÄRLEDA i stället för att väljas, och den valda enligt
 *    "hellre överskatta än underskatta".
 *  · `low`  = alla var vision-anrop ⇒ största möjliga nämnare ⇒ lägsta inpris.
 * ⛔ Nästa faktura ska läsas för ett fönster som HELT ligger efter 2026-08-14 —
 * då är nämnaren fullständig och bandet försvinner.
 */
export const GEMINI_31_FLASH_LITE_BAND = { low: 0.159, high: 0.2136 } as const;

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Anthropic (platform.claude.com/docs/en/pricing)
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },

  // ── Google (Gemini) ────────────────────────────────────────────────────────
  /**
   * ⛔ **INPRISET ÄR KALIBRERAT MOT FAKTURA, UTPRISET ÄR LISTPRIS.**
   *    LISTPRIS: **$0,25 in / $1,50 ut** per MTok (avläst 2026-08-14). Det talet
   *    är kvar här i kommentaren med flit — raden nedan är inte längre listpriset
   *    och får inte läsas som ett.
   *
   *    FAKTURAN (den enda vi läst): Googles konsol 2026-08-02 visade **0,82 kr**
   *    mot admin-diagnostikens 97 anrop = 362 353 in- och 5 565 ut-tokens.
   *
   * ⛔ **SNAPSHOTET ÄR ETT KLOCKSLAG, INTE ETT DYGN.** Verifierat mot prod
   *    2026-08-29: de tre talen är gemini-summan KUMULATIVT t.o.m. 16:59 UTC den
   *    2026-08-02 (de stämmer på tokenen exakt vid den timgränsen). Vid midnatt
   *    samma dygn stod samma summa på **106 anrop / 396 013 in / 6 076 ut**.
   *    Blandas ett dygnstal med ett klockslagstal ändras nämnaren ~9 % utan att
   *    någon enskild siffra ser konstig ut — läs alltid av BÅDA i samma ögonblick.
   *
   * ⛔ **DEN GAMLA KALIBRERINGEN (0,20/0,80) VAR FITTAD MOT FEL VÄXELKURS.** Den
   *    påstod sig reproducera 0,82 kr "vid ~10,6 SEK/USD". ECB:s kurs närmaste
   *    bankdag före fakturan (2026-07-31) var **9,5651** — verifierat mot
   *    Frankfurter 2026-08-29. 10,6 är i praktiken FALLBACK-kursen (1050 öre) i
   *    `exchange-rate.ts`, dvs exakt den fälla `.claude/rules/admin-ops.md`
   *    redan varnar för. Två fel tog delvis ut varandra.
   *    ⚠️ **MEN 9,5651 ÄR ETT ANTAGANDE, INTE EN AVLÄSNING.** 0,82 kr är Googles
   *    EGEN SEK-omräkning i konsolens faktureringsvaluta; vilken kurs de använde
   *    står ingenstans, och Google Cloud växlar inte på ECB-spot per dag. Hela
   *    härledningen nedan ärver den osäkerheten rakt av.
   *
   *    Räknat om vid 9,5651: fakturan är **$0,085728** för den tokenmängden.
   *      · listpris 0,25/1,50 → $0,098936 = **+15,4 %**
   *      · gamla "kalibreringen" 0,20/0,80 → $0,076923 = **−10,3 %**
   *
   * ⛔ **FAKTURAN PINNAR BARA INPRISET, OCH SVARET ÄR ETT BAND — INTE EN PUNKT.**
   *
   *    (a) **UTPRISET ÄR OSYNLIGT FÖR FAKTURAN.** Utdelen är 9,7 % av notan vid
   *        paret nedan (och 5,2 % först om utpriset vore 0,80), så $0,80 och
   *        $1,50 går inte att skilja åt. Löser man ut inpriset får man
   *        **$0,21355 OM ut = 1,50**, eller **$0,22430 OM ut = 0,80**.
   *        ⛔ **DE TVÅ TALEN ÄR EN AVVÄGNINGSKURVA, INTE ETT INTERVALL** (rättat
   *        2026-08-29): $0,2243 gäller BARA ihop med ut = 0,80. Att para kurvans
   *        övre ände med det HÖGRE utpriset dubbelräknar utpriset — det var
   *        precis så påståendet "0,22 ligger i bandet $0,2135–$0,2243" uppstod,
   *        och det är därför residualen blev +2,7 % i stället för 0.
   *
   *    (b) **NÄMNAREN ÄR BEVISLIGEN OFULLSTÄNDIG, OCH DET RÖR TALET SEX GÅNGER
   *        MER ÄN RESIDUALEN.** Diagnostiken (`v: 1`) skrivs BARA för admin.
   *        MÄTT mot prod 2026-08-29: i fakturafönstret — 2026-08-02 01:14 UTC, då
   *        Gemini slogs på, → 17:00 UTC — finns **29 skanningar helt utan
   *        diagnostik**, och kostnadsavtrycket (`costModel`) fanns ännu inte
   *        (fältet kom 2026-08-14) ⇒ **0 av de 29 bär spår av om vision kördes**.
   *        Google fakturerade dem ändå i samma 0,82 kr. 362 353 är alltså en
   *        UNDRE gräns för nämnaren ⇒ $0,21355 är en ÖVRE gräns för inpriset.
   *        Ytterlägena, räknade med de 97 mätta anropens medel (3 735,6 in /
   *        57,4 ut per anrop) och ut = 1,50:
   *          · alla 29 avgjordes av BILDEN (0 kr) → nämnare 362 353 → **$0,2136**
   *          · 17 av 29 var vision (samma 58,8 % som bland de MÄTTA raderna i
   *            exakt samma fönster: 97 gemini mot 68 bild) → **$0,1783**
   *          · alla 29 var vision → nämnare 470 685 → **$0,1591**
   *        Bandet är **$0,159–$0,2136**, en spännvidd på 34 %. Rundningen i
   *        "0,82 kr" (±0,005 kr) rör talet ±0,7 % och är brus vid sidan av detta.
   *
   * ⛔ **VALET: BANDETS ÖVRE ÄNDE, $0,2136 — OCH DET ÄR ETT VAL, INTE EN MÄTNING.**
   *    Varje oräknat anrop drar det sanna inpriset NEDÅT, så övre änden är det
   *    högsta fakturan kan bära. Där ligger vi med flit, av två skäl: en
   *    kostnadsvy ska hellre överskatta än underskatta (samma regel som
   *    Sonnet-intropriset), och det är den enda punkten i bandet som går att
   *    HÄRLEDA i stället för att väljas — de andra kräver en gissning om vad de 29
   *    raderna gjorde. Talet är $0,213551 avrundat UPPÅT till fyra decimaler
   *    (uppåt = åt det säkra hållet). Residual mot fakturans egen tokenmängd:
   *    **+0,02 %**, mot +15,4 % (listpris) och −10,3 % (gamla kalibreringen).
   *    Utpriset lämnas på LISTPRIS: fakturan ser det inte, se (a).
   *    ⛔ **0,22 VAR FEL OCH FÅR INTE TILLBAKA** (rättat 2026-08-29). Det ligger
   *    ÖVER hela bandet — inte i det — och motiverades med ett intervall som inte
   *    finns. Ett tal som ingen härledning når är en åsikt, oavsett hur nära det
   *    råkar hamna.
   *
   * ⚠️ **KALIBRERINGEN ÄR GAMMAL: EN faktura, läst 2026-08-02, ingen sedan.**
   *    Mätt 2026-08-29 är det här den ENDA modell som någonsin fakturerats i
   *    skannern (1 130 anrop, 4 206 534 in / 63 663 ut — summerat på `costUsage`,
   *    inte på diagnostikens `usage`: den senare finns bara på admin-rader och
   *    ger 152 in/anrop, vilket är ett omöjligt tal för ett vision-anrop).
   *    ⛔ **NÄSTA FAKTURA SKA LÄSAS PÅ ETT SÄTT SOM SLIPPER BANDET**: läs
   *    konsolsiffran för ett fönster som HELT ligger efter 2026-08-14, då bär
   *    varje rad `costModel` + `costUsage` och nämnaren är fullständig. Dividera
   *    med den kurs `getRatesOre()` gav den dagen (aldrig fallbacken), notera att
   *    Googles egen omräkning ändå kan avvika, och skriv om det här stycket.
   */
  "gemini-3.1-flash-lite": {
    inputPerMTok: GEMINI_31_FLASH_LITE_BAND.high,
    outputPerMTok: 1.5,
  },
  // LISTPRIS, OKALIBRERAT: ingen faktura har någonsin täckt den här modellen
  // (mätt 2026-08-29: 3 GradingJob-rader, alla från 2026-08-05 och alla UTAN
  // `costUsage`, dvs OMÄTTA — 0 rader i ScannerJob). Default för BÅDE
  // GRADING_MODEL_PREMIUM_GEMINI och SCANNER_MODEL_PRECISE (gemini-grenen).
  "gemini-3.6-flash": { inputPerMTok: 1.5, outputPerMTok: 7.5 },
  // ⛔ BÅDA TALEN ÄR HÄRLEDDA, ALDRIG AVLÄSTA: 9,375 = 7,5 / 0,8 ur
  // leverantörens "20 % billigare ut". docs/SCANNER.md bär SAMMA par
  // (1,50 / 9,375) — det är samma uträkning skriven två gånger, inte en
  // oberoende bekräftelse. MÄTT 2026-08-29: **0 rader i hela ScannerJob- OCH
  // GradingJob-tabellen** bär modellen, så ingen faktura har någonsin kunnat
  // rätta den. Posten finns bara så gamla rader går att prissätta; 3.5 är strikt
  // dominerad av 3.6 och defaulten är flyttad därifrån.
  "gemini-3.5-flash": { inputPerMTok: 1.5, outputPerMTok: 9.375 },
};

/**
 * `AI_PRICE_OVERRIDES` = JSON, t.ex.
 *   {"claude-sonnet-5":{"inputPerMTok":2,"outputPerMTok":10}}
 * Nödventil för prisändringar mellan deployer. Trasig JSON ignoreras tyst —
 * en felskriven env-variabel får inte sänka admin-panelen.
 */
let overridesCache: Record<string, ModelPrice> | null = null;

function priceOverrides(): Record<string, ModelPrice> {
  if (overridesCache) return overridesCache;
  const raw = process.env.AI_PRICE_OVERRIDES;
  if (!raw) {
    overridesCache = {};
    return overridesCache;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ModelPrice>>;
    const out: Record<string, ModelPrice> = {};
    for (const [model, p] of Object.entries(parsed)) {
      if (
        typeof p?.inputPerMTok === "number" &&
        typeof p?.outputPerMTok === "number" &&
        p.inputPerMTok >= 0 &&
        p.outputPerMTok >= 0
      ) {
        out[model] = { inputPerMTok: p.inputPerMTok, outputPerMTok: p.outputPerMTok };
      }
    }
    overridesCache = out;
  } catch {
    overridesCache = {};
  }
  return overridesCache;
}

/** Bara för tester — nollställer den lata env-cachen. */
export function resetPriceOverridesCache(): void {
  overridesCache = null;
}

/**
 * Prislistan för en modell, eller `null` om vi inte känner modellen.
 *
 * Exakt träff först, sedan en PREFIX-match: leverantörerna lägger till
 * datumsuffix (`claude-haiku-4-5-20251001`) och vi vill inte tappa priset varje
 * gång en snapshot-variant dyker upp. Prefixet måste vara ≥ 8 tecken så en kort
 * sträng inte råkar matcha allt.
 */
export function priceForModel(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  const key = model.trim();
  if (!key) return null;
  const table = { ...MODEL_PRICES, ...priceOverrides() };
  if (table[key]) return table[key];
  let best: { id: string; price: ModelPrice } | null = null;
  for (const [id, price] of Object.entries(table)) {
    if (id.length >= 8 && key.startsWith(id)) {
      if (!best || id.length > best.id.length) best = { id, price };
    }
  }
  return best?.price ?? null;
}

/** Tokental från ett API-anrop. Båda fälten kommer från leverantörens `usage`. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Kostnaden för ETT anrop, i MIKRO-DOLLAR (en miljondels dollar).
 *
 * Heltal med flit: ett enskilt Haiku-anrop kostar ~2 300 µ$ (0,0023 $), så
 * dollar som flyttal hade tappat precision så fort man summerar tusentals rader.
 * Samma skäl som priser i öre i resten av appen.
 *
 * `null` = vi vet inte (okänd modell eller inga tokental). Aldrig 0.
 */
export function costMicroUsd(
  model: string | null | undefined,
  usage: Partial<TokenUsage> | null | undefined
): number | null {
  const price = priceForModel(model);
  if (!price) return null;
  const input = usage?.inputTokens;
  const output = usage?.outputTokens;
  if (typeof input !== "number" || typeof output !== "number") return null;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  if (input < 0 || output < 0) return null;
  const usd = (input / 1_000_000) * price.inputPerMTok + (output / 1_000_000) * price.outputPerMTok;
  return Math.round(usd * 1_000_000);
}

/**
 * Mikro-dollar → öre, via samma live-kurs som resten av appen
 * (`getCachedRatesOre().usdToOre`). Avrundas till hela öre; ett belopp under ett
 * halvt öre blir 0, vilket ÄR rätt här (till skillnad från ett marknadspris är
 * "kostade i princip ingenting" ett sant och användbart svar).
 */
export function microUsdToOre(microUsd: number, usdToOre: number): number {
  return Math.round((microUsd / 1_000_000) * usdToOre);
}
