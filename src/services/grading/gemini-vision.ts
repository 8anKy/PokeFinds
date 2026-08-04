/**
 * Kortgradering via Google Gemini. Andra leverantören bredvid Claude, för att
 * kostnaden per anrop skiljer sig kraftigt och kvaliteten på just DEN HÄR
 * bedömningen ("hur slitet är kortet?") bara går att avgöra genom mätning mot
 * riktiga kortfoton.
 *
 * ⛔ Prompt, fältspec, bildetiketter och svarstolkning kommer ur `contract.ts` —
 * samma som Claude-adaptern. Utan det jämför en A/B-körning prompter i stället
 * för modeller.
 *
 * ⛔ INGEN NY SDK. Anropet är ett REST-anrop med fetch, exakt som
 * `src/services/scanner/gemini-vision.ts` och `src/services/deal-verify/gemini.ts`:
 * `@google/genai` är ett paket till i bundlen för en funktion vi använder på ETT
 * ställe, och generateContent-formatet är stabilt. Kräver GEMINI_API_KEY.
 *
 * ⛔ 2.5-SERIEN ÄR SPÄRRAD FÖR NYA API-NYCKLAR (mätt i fält 2026-08-02, se
 * scanner/gemini-vision.ts): Google svarar "not available for new users" och
 * hänvisar till 3.x. Serien stängs dessutom ned 2026-10-16. Standardmodellerna
 * sätts därför i `index.ts` till 3.x — kontrollera tillgängligheten INNAN en
 * modell sätts som default.
 *
 * ⛔ BILDSTORLEKEN ÄR MEDVETET ORÖRD I DET HÄR BYTET. Graderingen laddar upp två
 * foton i full upplösning (upp till 5 MB styck) utan nedskalning, och det ÄR
 * värt att fixa — men i en EGEN ändring. Ändras bilderna samtidigt som modellen
 * går varken kostnaden eller kvaliteten att tillskriva någondera (samma varning
 * som står i scanner/gemini-vision.ts).
 */
import { ServiceError } from "@/lib/errors";
import {
  GRADE_FIELDS,
  GRADE_REQUIRED,
  GRADE_TOOL_DESCRIPTION,
  GRADE_TOOL_NAME,
  IMAGE_LABEL_BACK,
  IMAGE_LABEL_FRONT,
  SYSTEM,
  buildClosingInstruction,
  buildGradeResult,
  parseGradingImage,
} from "@/services/grading/contract";
import type { GradeResult, GradingAdapter, GradingContext } from "./types";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * ⛔ GEMINI TAR INTE GIF. Stödda bildtyper är png, jpeg, webp, heic och heif —
 * medan den DELADE `parseDataUrl` släpper igenom gif (den unionen är Claudes
 * supersetet, och Claude tar gif). Utan den här kontrollen blir följden ett
 * ogenomskinligt 400 från Google som användaren får se som "gick inte att
 * tolka". Hellre ett ärligt formatfel som säger vad hen ska göra.
 */
const GEMINI_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Tänkandet går INTE att stänga av på Gemini 3 — det går bara att skruva ner.
 * Att fylla i ett schema med sju fält kräver ingen deliberation, så "minimal".
 *
 * ⛔ OVERIFIERAT MOT EN LEVANDE NYCKEL (vi har ingen i utvecklingsmiljön). Skulle
 * Google svara 400 "Unknown name" eller "Invalid enum value" ligger råtexten i
 * loggen (se felmappningen nedan) — sätt då GRADING_GEMINI_THINKING_LEVEL="" så
 * utelämnas fältet helt, utan kodändring och utan deploy. Taket nedan räcker
 * ensamt för att svaret ska rymmas även med tänkande påslaget.
 */
const DEFAULT_THINKING_LEVEL = "minimal";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name?: string; args?: Record<string, unknown> };
}

/** Fältspecens typer i OpenAPI-form (Gemini), t.ex. "boolean" → "BOOLEAN". */
function geminiSchema() {
  const properties: Record<string, unknown> = {};
  for (const f of GRADE_FIELDS) {
    properties[f.name] = {
      type: f.type.toUpperCase(),
      description: f.description,
      ...(f.enum ? { enum: f.enum } : {}),
    };
  }
  return { type: "OBJECT", properties, required: GRADE_REQUIRED };
}

/** Data-URL → inlineData-part, med formatkontrollen ovan. */
function inlineImage(dataUrl: string, side: string): GeminiPart {
  const img = parseGradingImage(dataUrl);
  if (!GEMINI_MEDIA_TYPES.has(img.mediaType)) {
    throw new ServiceError(
      400,
      `Bildformatet (${img.mediaType}) stöds inte för gradering med den här modellen. Använd JPG, PNG eller WEBP för ${side}.`
    );
  }
  return { inlineData: { mimeType: img.mediaType, data: img.data } };
}

export class GeminiVisionGradingAdapter implements GradingAdapter {
  name = "gemini";

  constructor(private readonly model: string) {}

  async grade(
    frontDataUrl: string,
    backDataUrl: string,
    context?: GradingContext
  ): Promise<GradeResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ServiceError(
        503,
        "AI-gradering är inte konfigurerad (GEMINI_API_KEY saknas)."
      );
    }

    // Bilderna MÄRKS med text emellan — samma ordning och etiketter som hos
    // Claude, annars mäter A/B-körningen inramningen i stället för modellen.
    // Och utan etiketter vet modellen inte vilken sida den tittar på: baksidans
    // whitening och framsidans centrering är olika bedömningar.
    const parts: GeminiPart[] = [
      { text: IMAGE_LABEL_FRONT },
      inlineImage(frontDataUrl, "framsidan"),
      { text: IMAGE_LABEL_BACK },
      inlineImage(backDataUrl, "baksidan"),
      { text: buildClosingInstruction(context?.cardName) },
    ];

    const thinkingLevel =
      process.env.GRADING_GEMINI_THINKING_LEVEL ?? DEFAULT_THINKING_LEVEL;

    const res = await fetch(`${ENDPOINT}/${this.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts }],
        tools: [
          {
            functionDeclarations: [
              {
                name: GRADE_TOOL_NAME,
                description: GRADE_TOOL_DESCRIPTION,
                parameters: geminiSchema(),
              },
            ],
          },
        ],
        // ANY + allowedFunctionNames = tvingat verktygsanrop, motsvarigheten
        // till Anthropics tool_choice. Utan det svarar modellen i fritext och
        // hela den strukturerade vägen faller.
        toolConfig: {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: [GRADE_TOOL_NAME],
          },
        },
        generationConfig: {
          temperature: 0,
          // ⛔ maxOutputTokens ÄR TAKET FÖR TÄNKANDE + SVAR på de modeller som
          // tänker (hela 3-serien), och Gemini 3 tillåter inte att tänkandet
          // stängs av — ett snålt tak klipper alltså verktygsanropet TYST. Att
          // bära över Claude-vägens 1024 rakt av hade varit precis det felet.
          // Graderingen är ~150 tokens (sju tal + en kort svensk motivering);
          // 2048 är marginal, inte behov.
          maxOutputTokens: 2048,
          ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // RÅTEXTEN HÖR HEMMA I LOGGEN, INTE I ANVÄNDARENS ANSIKTE. Ett 404 från
      // Google ("This model … is no longer available to new users") är det som
      // gör felet diagnosbart på sekunder — men den som graderar ett kort ska
      // inte mötas av en vägg med JSON.
      console.error(
        `[grading/gemini] ${this.model} → ${res.status}: ${body.slice(0, 500)}`
      );
      // KONFIGURATIONSFEL ÄR INTE ÖVERGÅENDE: 401/403/404 betyder fel nyckel
      // eller en modell som kontot inte får använda, och varje ny gradering
      // faller likadant. "Försök igen" vore en lögn.
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        throw new ServiceError(
          503,
          "AI-graderingen är felkonfigurerad (modell eller API-nyckel) — försök igen senare."
        );
      }
      if (res.status === 429) {
        throw new ServiceError(
          429,
          "AI-graderingen är tillfälligt överbelastad. Vänta en stund och försök igen."
        );
      }
      throw new ServiceError(502, "Graderingen kunde inte tolkas. Försök igen.");
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const call = json.candidates?.[0]?.content?.parts?.find(
      (p) => p.functionCall?.name === GRADE_TOOL_NAME
    )?.functionCall;
    if (!call?.args) {
      // Tvingat verktyg + inget verktygsanrop = trunkering (tänkandet åt upp
      // taket) eller ett spärrat svar. Loggas som en EGEN rad: ser man den här
      // återkomma är maxOutputTokens ovan för snålt för modellen man valt.
      console.warn(`[grading/gemini] ${this.model}: inget verktygsanrop i svaret.`);
      throw new ServiceError(502, "Graderingen kunde inte tolkas. Försök igen.");
    }

    // API:ts egna tokental → verklig kostnad per anrop, aldrig en gissning.
    // ⛔ Loggas i stället för att returneras: GradeResult bär inget usage-fält,
    // och att lägga till ett hade ändrat vad som skrivs till GradingJob.result i
    // samma ändring som leverantörsbytet. Fakturan är ändå facit (se
    // skannerkostnaden i CLAUDE.md) — det här är spårningen MELLAN fakturor.
    console.log(
      `[grading/gemini] ${this.model} in=${json.usageMetadata?.promptTokenCount ?? 0} ut=${json.usageMetadata?.candidatesTokenCount ?? 0}`
    );

    // ⛔ ALL tolkning i den DELADE buildGradeResult — se contract.ts.
    return buildGradeResult(call.args, this.model);
  }
}
