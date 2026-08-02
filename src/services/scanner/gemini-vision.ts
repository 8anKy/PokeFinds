/**
 * Kort-IDENTIFIERING via Google Gemini. Andra leverantören bredvid Claude, för
 * att kostnaden per anrop skiljer sig kraftigt och accepterbarheten (läser den
 * samlarnumret?) bara går att avgöra genom MÄTNING i fält.
 *
 * ⛔ Prompt, fältspec och svarstolkning kommer ur `vision-contract.ts` — samma
 * som Claude-adaptern. Utan det jämför en A/B-körning prompter i stället för
 * modeller.
 *
 * ⛔ INGEN NY SDK. Anropet är ett REST-anrop med fetch: `@google/genai` är ett
 * paket till i bundlen för en funktion vi använder på ETT ställe, och
 * generateContent-formatet är stabilt. Kräver GEMINI_API_KEY.
 *
 * KOSTNAD (mätt mot vår egen last 2026-08-02): Gemini debiterar 258 tokens per
 * 768-ruta, och rutstorleken räknas på bildens KORTSIDA — vår nummerremsa
 * (~1280x393) blir därför 10 rutor (2580 tokens) medan hela kortet (~916x1280)
 * blir 6 (1548). Totalt ~4850 in-tokens mot Claudes uppmätta 2955 för SAMMA
 * bilder. Per anrop: 2.5 Flash-Lite $0,00055 · 2.5 Flash $0,00184 mot Haikus
 * uppmätta $0,0037. En OMFORMAD närbild (kortsidan ≥ ~2/3 av långsidan) sänker
 * notan mer än ett modellbyte — men ändra INTE bilderna samtidigt som modellen,
 * då går utfallet inte att tillskriva någondera.
 */
import { ServiceError } from "@/lib/errors";
import type { OcrAdapter, OcrResult } from "@/services/scanner/types";
import {
  CARD_FIELDS,
  CARD_REQUIRED,
  CARD_TOOL_DESCRIPTION,
  CARD_TOOL_NAME,
  CLOSING_INSTRUCTION,
  IMAGE_LABEL_DETAIL,
  IMAGE_LABEL_FULL,
  SYSTEM,
  buildOcrResult,
  parseDataUrl,
} from "@/services/scanner/vision-contract";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Fältspecens typer i OpenAPI-form (Gemini), t.ex. "boolean" → "BOOLEAN". */
function geminiSchema() {
  const properties: Record<string, unknown> = {};
  for (const f of CARD_FIELDS) {
    properties[f.name] = {
      type: f.type.toUpperCase(),
      description: f.description,
      ...(f.enum ? { enum: f.enum } : {}),
    };
  }
  return { type: "OBJECT", properties, required: CARD_REQUIRED };
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name?: string; args?: Record<string, unknown> };
}

export class GeminiVisionOcrAdapter implements OcrAdapter {
  readonly name = "gemini";

  constructor(private readonly model: string) {}

  async extractCardInfo(imageDataUrl: string, detailDataUrl?: string): Promise<OcrResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ServiceError(
        503,
        "Kortidentifiering är inte konfigurerad (GEMINI_API_KEY saknas)."
      );
    }
    const img = parseDataUrl(imageDataUrl);
    const detail = detailDataUrl ? parseDataUrl(detailDataUrl) : null;

    // Bilderna MÄRKS med text emellan — samma ordning och etiketter som hos
    // Claude, annars mäter A/B-körningen inramningen i stället för modellen.
    const parts: GeminiPart[] = [
      { text: IMAGE_LABEL_FULL },
      { inlineData: { mimeType: img.mediaType, data: img.data } },
    ];
    if (detail) {
      parts.push({ text: IMAGE_LABEL_DETAIL });
      parts.push({ inlineData: { mimeType: detail.mediaType, data: detail.data } });
    }
    parts.push({ text: CLOSING_INSTRUCTION });

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
                name: CARD_TOOL_NAME,
                description: CARD_TOOL_DESCRIPTION,
                parameters: geminiSchema(),
              },
            ],
          },
        ],
        // ANY + allowedFunctionNames = tvingat verktygsanrop, motsvarigheten
        // till Anthropics tool_choice. Utan det svarar modellen i fritext och
        // hela den strukturerade vägen faller.
        toolConfig: {
          functionCallingConfig: { mode: "ANY", allowedFunctionNames: [CARD_TOOL_NAME] },
        },
        generationConfig: { temperature: 0, maxOutputTokens: 512 },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 429 = kvot (gratisnivån är hårt rate-limitad) — säg det rakt ut i
      // stället för ett generiskt fel, annars läses det som en modellmiss.
      const hint = res.status === 429 ? " (kvot/rate limit)" : "";
      throw new ServiceError(
        502,
        `Kortet kunde inte tolkas${hint}. Gemini svarade ${res.status}: ${body.slice(0, 200)}`
      );
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const call = json.candidates?.[0]?.content?.parts?.find(
      (p) => p.functionCall?.name === CARD_TOOL_NAME
    )?.functionCall;
    if (!call?.args) {
      throw new ServiceError(502, "Kortet kunde inte tolkas. Försök igen.");
    }
    // API:ts egna tokental → verklig kostnad per anrop, aldrig en gissning.
    return buildOcrResult(call.args, {
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    });
  }
}
