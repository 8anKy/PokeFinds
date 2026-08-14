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


// SAMLARNUMRET ÄR HELA IDENTITETEN. Mätt mot prod: 18 938 av 20 563 kort (92 %)
// delar namn med minst ett annat kort, så utan nummer finns ingenting kvar att
// matcha på — katalogslagningen träffar rätt i 100 % av fallen med ett korrekt
// läst nummer, mot ~23 % utan. Därför är prompten nästan helt ägnad åt numret.
//
// BOKSTÄVERNA I NUMRET ÄR EN DEL AV DET: "TG10" är inte kort 10, "SWSH034" är
// inte kort 34, "130a" är inte 130 — de är olika kort med olika värde. Det är
// dessutom precis de tryckningarna någon bryr sig om att skanna (Trainer Gallery,
// Shiny Vault, promos, alternativa tryck); vanliga commons skannar man inte.


// `strict: true` garanterar att svaret validerar mot schemat (kräver
// additionalProperties:false + required). Kostar ingenting och tar bort en
// felkälla: ett saknat fält föll förut tillbaka på konfidens 0,5 och kunde låsa
// UI:t på en gissning.
const CARD_TOOL: Anthropic.Tool = {
  name: CARD_TOOL_NAME,
  description: CARD_TOOL_DESCRIPTION,
  // `strict: true` garanterar att svaret validerar mot schemat (kräver
  // additionalProperties:false + required). Kostar ingenting och tar bort en
  // felkälla: ett saknat fält föll förut tillbaka på konfidens 0,5.
  strict: true,
  input_schema: {
    type: "object",
    // ⛔ Fälten byggs ur den DELADE specen (vision-contract.ts) — aldrig en egen
    // kopia här. Två leverantörer med var sin fältbeskrivning gör en A/B-mätning
    // meningslös: då jämför man prompter, inte modeller.
    properties: Object.fromEntries(
      CARD_FIELDS.map((f) => [
        f.name,
        f.enum
          ? { type: f.type, enum: f.enum, description: f.description }
          : { type: f.type, description: f.description },
      ])
    ),
    required: CARD_REQUIRED,
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

export class ClaudeVisionOcrAdapter implements OcrAdapter {
  readonly name = "claude";

  // Publik: kostnaden per skanning räknas ur modellnamnet, se OcrAdapter.model.
  constructor(readonly model: string) {}

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
      { type: "text", text: IMAGE_LABEL_FULL },
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
    content.push({ type: "text", text: CLOSING_INSTRUCTION });

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
      tool_choice: { type: "tool", name: CARD_TOOL_NAME },
      messages: [{ role: "user", content }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) {
      throw new ServiceError(502, "Kortet kunde inte tolkas. Försök igen.");
    }
    // ⛔ ALL tolkning i den DELADE buildOcrResult — se vision-contract.ts.
    return buildOcrResult(toolUse.input as Record<string, unknown>, {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }
}
