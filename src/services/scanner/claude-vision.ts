/**
 * Riktig kort-IDENTIFIERING via Claude vision (Anthropic SDK). Läser kortets
 * NAMN och samlarnummer ur EN bild/videoruta och returnerar ett OcrResult som
 * scannerns matchCards() matchar mot katalogen. En snabb modell (Haiku) räcker
 * — uppgiften är att känna igen kortet och läsa dess text, inte bedöma skick.
 *
 * Strukturerat svar via tvingat verktyg (`report_card`) — robustare än fritext.
 * Kräver ANTHROPIC_API_KEY (OCR_PROVIDER=claude). Annars används mock-adaptern.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ServiceError } from "@/lib/errors";
import type { OcrAdapter, OcrResult } from "@/services/scanner/types";

function parseDataUrl(dataUrl: string): {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
} {
  const m = /^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,(.+)$/i.exec(dataUrl);
  if (!m) {
    throw new ServiceError(400, "Bildformatet stöds inte. Använd JPG, PNG, WEBP eller GIF.");
  }
  const raw = m[1].toLowerCase();
  const mediaType = (raw === "image/jpg" ? "image/jpeg" : raw) as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";
  return { mediaType, data: m[2] };
}

// SAMLARNUMRET ÄR HELA IDENTITETEN. Mätt mot prod: 18 938 av 20 563 kort (92 %)
// delar namn med minst ett annat kort, så utan nummer finns ingenting kvar att
// matcha på — katalogslagningen träffar rätt i 100 % av fallen med ett korrekt
// läst nummer, mot ~23 % utan. Därför är prompten nästan helt ägnad åt numret.
//
// BOKSTÄVERNA I NUMRET ÄR EN DEL AV DET: "TG10" är inte kort 10, "SWSH034" är
// inte kort 34, "130a" är inte 130 — de är olika kort med olika värde. Det är
// dessutom precis de tryckningarna någon bryr sig om att skanna (Trainer Gallery,
// Shiny Vault, promos, alternativa tryck); vanliga commons skannar man inte.
const SYSTEM = [
  "Du identifierar Pokémon-samlarkort från EN bild eller videoruta.",
  "Läs kortets namn (t.ex. 'Charizard ex').",
  "SAMLARNUMRET ÄR AVGÖRANDE: många kort delar namn (t.ex. flera 'Wailord'),",
  "och numret är det enda som skiljer dem åt. Det står i regel i ett NEDRE HÖRN,",
  "ofta litet, som 'nummer/total' (t.ex. '41/159', '199/091') eller med set-kod",
  "(t.ex. 'SVP 041').",
  "Får du TVÅ bilder är den andra en närbild på kortets NEDERKANT: läs numret",
  "DÄR, inte i helbilden. Namnet läser du ur helbilden.",
  "FLERA TAL KONKURRERAR PÅ ETT KORT — bara ETT av dem är samlarnumret:",
  "talet uppe till HÖGER intill 'HP' är kortets livpoäng (t.ex. 110) och är",
  "ALDRIG samlarnumret; skadetalen vid attackerna är det inte heller; och",
  "årtalet i copyrightraden ('2022') är det inte heller.",
  "Samlarnumret står längst ned, i regel till VÄNSTER (äldre kort: till höger),",
  "med den minsta texten på hela kortet.",
  "SKRIV AV NUMRET EXAKT SOM DET STÅR, tecken för tecken — gissa aldrig.",
  "BOKSTÄVER I NUMRET ÄR EN DEL AV NUMRET och får ALDRIG utelämnas:",
  "'TG10/TG30' skrivs 'TG10/TG30' (inte '10'), 'GG08' skrivs 'GG08',",
  "'SWSH034' skrivs 'SWSH034', 'SV075' skrivs 'SV075'.",
  "En efterföljande bokstav hör också till numret: '130a' är INTE '130'.",
  "Behåll inledande nollor och mellanslag som de står ('MEP 074').",
  "SÄTT numberLegible=false om du inte kunde läsa varje tecken tydligt — om du",
  "gissade, härledde numret ur kortets utseende, eller inte såg det. Ett påhittat",
  "nummer är VÄRRE än inget: det pekar ut ett annat riktigt kort. Att svara",
  "numberLegible=false är alltid ett godtagbart svar.",
  "ANGE OCKSÅ KORTRAMENS GENERATION (era): ramdesignen syns även när texten är",
  "oläslig, och den skiljer kort som delar namn. OBS: ramen är GUL på ALLA kort",
  "före 2023 — ramfärgen skiljer bara sv från resten. Skilj epokerna på LAYOUTEN:",
  "wotc (1999–2003, Base till Skyridge): evolutionsruta med miniatyrbild UPPE",
  "till vänster, OVANFÖR konsten. ex (2003–2007, Ruby & Sapphire till Power",
  "Keepers): STAGE-flik med miniatyrbild NERE till vänster som ÖVERLAPPAR",
  "konsten. dp (2007–2011, Diamond & Pearl/Platinum/HGSS). bwxy (2011–2016,",
  "Black & White/XY). sm (2017–2019, Sun & Moon). swsh (2020–2022, Sword &",
  "Shield). sv (2023–, Scarlet & Violet: SILVER/GRÅ ram). Osäker: okand.",
  "LÄS OCKSÅ KORTETS HP — det stora talet uppe till höger intill 'HP' (t.ex.",
  "90, 150). HP:t skiljer kort som delar namn. Sätt hp=0 om det inte går att",
  "läsa säkert — gissa aldrig.",
  "Returnera en konfidens 0–1 utifrån hur tydligt kortet syns och hur säker du är.",
  "Om inget tydligt Pokémon-kort syns: sätt cardVisible=false och låg konfidens.",
].join(" ");

// `strict: true` garanterar att svaret validerar mot schemat (kräver
// additionalProperties:false + required). Kostar ingenting och tar bort en
// felkälla: ett saknat fält föll förut tillbaka på konfidens 0,5 och kunde låsa
// UI:t på en gissning.
const CARD_TOOL: Anthropic.Tool = {
  name: "report_card",
  description: "Rapportera det identifierade kortet.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      cardVisible: { type: "boolean", description: "Syns ett Pokémon-kort tydligt i bilden?" },
      name: { type: "string", description: "Kortets namn, t.ex. 'Charizard ex'. Tom sträng om okänt." },
      number: {
        type: "string",
        description:
          "Samlarnumret EXAKT som det står i nedre hörnet, med eventuell total: " +
          "'41/159', '4/102', 'TG10/TG30', 'GG08', 'SWSH034', 'SV075', '130a', 'MEP 074'. " +
          "Bokstäver före OCH efter siffrorna hör till numret och ska med. " +
          "Tom sträng om oläsligt.",
      },
      // EGEN FRÅGA I STÄLLET FÖR ETT TOMT FÄLT. Prompten har hela tiden sagt
      // "hellre tomt än fel nummer" — och modellen struntar i det: MÄTT över 26
      // riktiga skanningar var 16 nummer syntaktiskt giltiga och praktiskt taget
      // inget korrekt. Trainer Gallery-korten (TG01/TG30, TG04/TG30, TG07/TG30,
      // TG08/TG30) rapporterades som "43/102", "37/102", "40/202", "89/136", och
      // "41/108" kom tillbaka för BÅDE en Crawdaunt och en Rayquaza. Ett
      // uppdiktat nummer är värre än inget: det kan träffa ett riktigt kort.
      // En modell svarar mer tillförlitligt på en rak ja/nej-fråga än den
      // avstår från att fylla i ett fält.
      numberLegible: {
        type: "boolean",
        description:
          "Kunde du läsa VARJE TECKEN i samlarnumret tydligt i bilden? " +
          "false om du gissade, härledde det ur kortets utseende, eller inte kunde se det.",
      },
      // RAMGENERATIONEN — läsbar när numret inte är det. 28 kort heter exakt
      // "Gyarados"; utan nummer stod alla på samma poäng och tie-breaken
      // "nyast set" valde alltid fel epok för ett vintage-kort. Ramdesignen är
      // en GROV visuell signal som modellen klarar även på suddiga skärmfoton,
      // och den används bara som liten tie-breaker (se ERA_YEARS/ERA_WEIGHT).
      // ⛔ SÄG ALDRIG "gul ram = wotc" — ALLA kort före 2023 har gul ram, så
      // den ledtråden klassade en EX-era-Gyarados (2005) som wotc (mätt
      // 2026-07-30, tre skanningar i rad). wotc/ex skiljs på var evolutions-
      // rutan sitter: ovanför konsten (wotc) mot överlappande fliken (ex).
      era: {
        type: "string",
        enum: ["wotc", "ex", "dp", "bwxy", "sm", "swsh", "sv", "okand"],
        description:
          "Kortramens generation utifrån LAYOUTEN, inte ramfärgen (gul ram t.o.m. " +
          "2022): wotc = evolutionsruta uppe till vänster (1999–2003), ex = " +
          "STAGE-flik som överlappar konsten nere till vänster (2003–2007), " +
          "dp (2007–2011), bwxy (2011–2016), sm (2017–2019), swsh (2020–2022), " +
          "sv = silver/grå ram (2023–). Osäker = okand.",
      },
      // HP — kortets STÖRSTA tal och därmed den mest läsbara särskiljaren
      // mellan namntvillingar. Modellen har BEVISAT att den läser det: den
      // svarade med HP:t när vi bad om samlarnumret (fix 14f4a52). Nu används
      // den läsningen i stället för att bekämpas.
      hp: {
        type: "integer",
        description:
          "Kortets HP — det stora talet uppe till höger intill 'HP' (t.ex. 90, " +
          "150, 220). 0 om det inte syns eller inte går att läsa säkert.",
      },
      confidence: { type: "number", description: "0–1" },
    },
    required: ["cardVisible", "name", "number", "numberLegible", "era", "hp", "confidence"],
    additionalProperties: false,
  },
};

/**
 * MODELLENS SVAR ÄR INTE ALLTID ETT KORTNUMMER.
 *
 * MÄTT i produktion (4 av 12 skanningar): fältet innehöll fragment av
 * verktygsanropets EGET serialiseringsformat, t.ex.
 *   `</antml parameters><parameter name="confidence">0.6`
 * `strict: true` fångar det inte — fältet är typat `string`, så vilken sträng som
 * helst validerar. Och `parseGuessedNumber` plockar villigt ut en siffra ur
 * skräpet, vilket ger ett PÅHITTAT nummer som kan matcha ett riktigt kort exakt
 * (mätt separat: "041/193" träffade Paldean Tauros 41 i ett set med 193 kort).
 *
 * Ett riktigt kortnummer är kort och består av siffror, bokstäver och på sin höjd
 * ett snedstreck, bindestreck eller mellanslag: "4/102", "TG07/TG30", "SWSH034",
 * "MEP 074", "130a". Allt annat är inte ett nummer — och tomt är ärligare än
 * gissat, eftersom matchningen då faller tillbaka på namn och bild.
 */
export function sanitizeNumber(raw: string): string {
  const s = raw.trim();
  if (s.length === 0 || s.length > 16) return "";
  // Tillåtna tecken och form: alfanumeriska grupper åtskilda av ETT mellanslag,
  // snedstreck eller bindestreck. Täcker "4/102", "TG07/TG30", "SWSH034",
  // "MEP 074", "130a", "SVP 041". Ett `<`, `"` eller `=` diskvalificerar direkt.
  if (!/^[A-Za-z0-9]+(?:[ /-][A-Za-z0-9]+)*$/.test(s)) return "";
  if ((s.match(/\//g) ?? []).length > 1) return "";
  if ((s.match(/ /g) ?? []).length > 1) return "";
  // Utan siffra är det bara ett kortnummer om det är kort — Unowns alfabet ("A",
  // "ONE"). Annars är det en MENING modellen skrivit i fältet ("inget nummer").
  if (!/\d/.test(s) && s.replace(/[^A-Za-z]/g, "").length > 4) return "";
  return s;
}

/** Samma skydd för namnet: markup eller radbrytningar är inte ett kortnamn. */
export function sanitizeName(raw: string): string {
  const s = raw.trim();
  if (s.length === 0 || s.length > 60) return "";
  return /[<>{}\n\r]/.test(s) ? "" : s;
}

export class ClaudeVisionOcrAdapter implements OcrAdapter {
  readonly name = "claude";

  constructor(private readonly model: string) {}

  async extractCardInfo(imageDataUrl: string, detailDataUrl?: string): Promise<OcrResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ServiceError(
        503,
        "Kortidentifiering är inte konfigurerad (ANTHROPIC_API_KEY saknas)."
      );
    }
    const client = new Anthropic({ apiKey });
    const img = parseDataUrl(imageDataUrl);
    const detail = detailDataUrl ? parseDataUrl(detailDataUrl) : null;

    // Bilderna MÄRKS med text emellan. Två omärkta bilder gör det oklart vilken
    // som är vilken, och hela poängen är att numret ska läsas ur den andra.
    const content: Anthropic.ContentBlockParam[] = [
      { type: "text", text: "Bild 1 — hela kortet (läs NAMNET här):" },
      {
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.data },
      },
    ];
    if (detail) {
      content.push(
        { type: "text", text: "Bild 2 — närbild på kortets NEDERKANT (läs SAMLARNUMRET här):" },
        {
          type: "image",
          source: { type: "base64", media_type: detail.mediaType, data: detail.data },
        }
      );
    }
    content.push({ type: "text", text: "Identifiera kortet och anropa report_card." });

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 256,
      // ⛔ UTAN DETTA TRUNKERAR ETT MODELLBYTE TYST. På Sonnet 5 (och Opus
      // 4.6+/5) är adaptivt tänkande PÅ när `thinking` utelämnas, och
      // `max_tokens` är taket för tänkande + svar — 256 klipper då FÖRE
      // verktygsanropet. Tänkande är fel verktyg för ren textavläsning med
      // tvingat verktyg, så det stängs av i stället för att höja taket (som
      // hade betalat tänk-tokens per skanning). Haiku 4.5 tar inte "disabled"
      // (äldre thinking-API) och tänker inte som standard → utelämna där.
      // OBS: claude-fable-5 avvisar "disabled" helt — använd inte den här.
      ...(this.model.includes("haiku") ? {} : { thinking: { type: "disabled" as const } }),
      system: SYSTEM,
      tools: [CARD_TOOL],
      tool_choice: { type: "tool", name: "report_card" },
      messages: [{ role: "user", content }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) {
      throw new ServiceError(502, "Kortet kunde inte tolkas. Försök igen.");
    }
    const input = toolUse.input as Record<string, unknown>;
    const cardVisible = input.cardVisible === true;
    const name = sanitizeName(typeof input.name === "string" ? input.name : "");
    // Numret används BARA när modellen själv säger att det var läsbart. Ett
    // uppdiktat nummer är aktivt skadligt — det kan matcha ett riktigt kort och
    // vinna över rätt kort. Saknas fältet (äldre svar) faller vi tillbaka på att
    // lita på numret, dvs beteendet som fanns förut.
    const legible = input.numberLegible !== false;
    const number = legible
      ? sanitizeNumber(typeof input.number === "string" ? input.number : "")
      : "";
    const confidence =
      typeof input.confidence === "number" && Number.isFinite(input.confidence)
        ? Math.min(1, Math.max(0, input.confidence))
        : 0.5;
    // strict:true garanterar enum-värdet; "okand" = ingen signal.
    const era = typeof input.era === "string" && input.era !== "okand" ? input.era : undefined;
    // Tryckta HP är 30–340 i jämna 10-tal; allt annat är en felläsning och
    // kastas hellre än att den matchar fel kort exakt (samma princip som
    // sanitizeNumber: ett påhittat tal träffar en riktig rad förr eller senare).
    const hpRaw = typeof input.hp === "number" ? Math.round(input.hp) : 0;
    const hp = hpRaw >= 30 && hpRaw <= 500 && hpRaw % 10 === 0 ? hpRaw : undefined;

    return {
      rawText: [name, number].filter(Boolean).join(" "),
      guessedName: cardVisible && name ? name : undefined,
      guessedNumber: cardVisible && number ? number : undefined,
      guessedEra: cardVisible ? era : undefined,
      guessedHp: cardVisible ? hp : undefined,
      // Inget kort i bild → 0 så att UI:t inte låser på en slumpträff.
      confidence: cardVisible ? confidence : 0,
    };
  }
}
