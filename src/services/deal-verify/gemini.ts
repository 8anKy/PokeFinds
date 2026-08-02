/**
 * Fynd-verifiering via Google Gemini. Andra leverantören bredvid Claude, för att
 * kostnaden per anrop skiljer sig kraftigt och kvaliteten på just DEN HÄR domen
 * ("är det samma sealed-SKU, och är den oöppnad?") bara går att avgöra genom
 * mätning mot riktiga annonser.
 *
 * ⛔ Prompt, fältspec och svarstolkning kommer ur `contract.ts` — samma som
 * Claude-adaptern. Utan det jämför en A/B-körning prompter i stället för modeller.
 *
 * ⛔ INGEN NY SDK. Anropet är ett REST-anrop med fetch, exakt som
 * `src/services/scanner/gemini-vision.ts`: `@google/genai` är ett paket till i
 * bundlen för en funktion vi använder på ETT ställe, och generateContent-formatet
 * är stabilt. Kräver GEMINI_API_KEY.
 *
 * ⛔ 2.5-SERIEN ÄR SPÄRRAD FÖR NYA API-NYCKLAR (mätt i fält 2026-08-02, se
 * gemini-vision.ts): Google svarar "not available for new users" och hänvisar
 * till 3.x. Standardmodellen här är därför 3.1 Flash-Lite, inte 2.5 Flash-Lite —
 * kontrollera tillgängligheten INNAN en modell sätts som default.
 */
import {
  SYSTEM,
  VERIFY_FIELDS,
  VERIFY_REQUIRED,
  VERIFY_TOOL_DESCRIPTION,
  VERIFY_TOOL_NAME,
  buildUserPrompt,
  buildVerdict,
  type DealVerification,
  type DealVerifyAdapter,
  type DealVerifyListing,
  type DealVerifyProduct,
} from "@/services/deal-verify/contract";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Fältspecens typer i OpenAPI-form (Gemini), t.ex. "boolean" → "BOOLEAN". */
function geminiSchema() {
  const properties: Record<string, unknown> = {};
  for (const f of VERIFY_FIELDS) {
    properties[f.name] = { type: f.type.toUpperCase(), description: f.description };
  }
  return { type: "OBJECT", properties, required: VERIFY_REQUIRED };
}

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
}

export class GeminiDealVerifyAdapter implements DealVerifyAdapter {
  readonly name = "gemini";

  constructor(
    readonly model: string,
    private readonly apiKey: string
  ) {}

  async verify(
    product: DealVerifyProduct,
    listing: DealVerifyListing
  ): Promise<DealVerification | null> {
    const res = await fetch(`${ENDPOINT}/${this.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      // Tradera-API:t kan hänga; svepet har 60 min totalt och en trasig annons
      // får inte äta dem. Samma storleksordning som fetchTraderaItem.
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [
          { role: "user", parts: [{ text: buildUserPrompt(product, listing) }] },
        ],
        tools: [
          {
            functionDeclarations: [
              {
                name: VERIFY_TOOL_NAME,
                description: VERIFY_TOOL_DESCRIPTION,
                parameters: geminiSchema(),
              },
            ],
          },
        ],
        // ANY + allowedFunctionNames = tvingat verktygsanrop, motsvarigheten
        // till Anthropics tool_choice. Utan det svarar modellen i fritext och
        // hela den strukturerade vägen faller.
        toolConfig: {
          functionCallingConfig: { mode: "ANY", allowedFunctionNames: [VERIFY_TOOL_NAME] },
        },
        // ⛔ maxOutputTokens ÄR TAKET FÖR TÄNKANDE + SVAR på de modeller som
        // tänker (2.5 Flash, hela 3-serien), och Gemini 3 tillåter inte att
        // tänkandet stängs av — ett snålt tak klipper alltså verktygsanropet
        // TYST. Domen är ~60 tokens; 1024 är marginal, inte behov. Tänkande
        // faktureras som utdata, men utdata är en försumbar post här (se
        // kostnadsnoten i src/jobs/verify-deals.ts).
        generationConfig: { temperature: 0, maxOutputTokens: 1024 },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // RÅTEXTEN HÖR HEMMA I LOGGEN. Ett 404 från Google ("This model … is no
      // longer available to new users") är det som gör felet diagnosbart på
      // sekunder — här finns ingen användare att skona, bara en Actions-logg.
      console.error(`[deal-verify/gemini] ${this.model} → ${res.status}: ${body.slice(0, 500)}`);
      throw new Error(`Gemini ${res.status}`);
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    };
    const call = json.candidates?.[0]?.content?.parts?.find(
      (p) => p.functionCall?.name === VERIFY_TOOL_NAME
    )?.functionCall;
    if (!call?.args) {
      // Tvingat verktyg + inget verktygsanrop = trunkering (tänkandet åt upp
      // taket) eller ett spärrat svar. Ingen dom → anroparen rör ingenting.
      console.warn(`[deal-verify/gemini] ${this.model}: inget verktygsanrop i svaret.`);
      return null;
    }
    const verdict = buildVerdict(call.args);
    if (!verdict) {
      // RÅFÄLTEN HÖR HEMMA I LOGGEN: utan dem går det inte att se OM det är
      // modellen eller schemaöversättningen som brister. Typiskt utfall att
      // vakta: booleanerna kommer tillbaka som STRÄNGAR ("true") — det tolkas
      // med flit inte, se buildVerdict.
      console.warn(
        `[deal-verify/gemini] ${this.model}: otolkbart svar ${JSON.stringify(call.args).slice(0, 300)}`
      );
    }
    return verdict;
  }
}
