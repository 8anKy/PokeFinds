/**
 * Fynd-verifiering via Claude (Anthropic SDK). Den URSPRUNGLIGA leverantören —
 * all mätning av Fynd-feedens kvalitet hittills är gjord med den, så den är
 * referensen ett leverantörsbyte ska mätas MOT.
 *
 * ⛔ Prompt, fältspec och svarstolkning kommer ur `contract.ts` — samma som
 * Gemini-adaptern. Utan det jämför en A/B-körning prompter i stället för modeller.
 *
 * Strukturerat svar via TVINGAT verktyg (`report_verification`) — fritext hade
 * behövt en egen parser, och en egen parser per leverantör är exakt det som gör
 * jämförelsen värdelös.
 */
import Anthropic from "@anthropic-ai/sdk";
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

const VERIFY_TOOL: Anthropic.Tool = {
  name: VERIFY_TOOL_NAME,
  description: VERIFY_TOOL_DESCRIPTION,
  input_schema: {
    type: "object",
    // ⛔ Fälten byggs ur den DELADE specen — aldrig en egen kopia här.
    properties: Object.fromEntries(
      VERIFY_FIELDS.map((f) => [f.name, { type: f.type, description: f.description }])
    ),
    required: VERIFY_REQUIRED,
  },
};

export class ClaudeDealVerifyAdapter implements DealVerifyAdapter {
  readonly name = "claude";

  constructor(
    readonly model: string,
    private readonly client: Anthropic
  ) {}

  async verify(
    product: DealVerifyProduct,
    listing: DealVerifyListing
  ): Promise<DealVerification | null> {
    const response = await this.client.messages.create({
      model: this.model,
      // ⛔ Höjs taket och modellen byts till en som TÄNKER som standard (Sonnet
      // 5, Opus 4.6+) är `max_tokens` taket för tänkande + svar — då klipps
      // verktygsanropet bort. Domen är ~60 tokens; 512 är utrymme, inte behov.
      max_tokens: 512,
      system: SYSTEM,
      tools: [VERIFY_TOOL],
      tool_choice: { type: "tool", name: VERIFY_TOOL_NAME },
      messages: [{ role: "user", content: buildUserPrompt(product, listing) }],
    });
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) {
      // Tvingat verktyg + inget verktygsanrop = modellen gjorde något annat
      // (trunkering, refusal). Ingen dom → anroparen rör ingenting.
      console.warn(`[deal-verify/claude] ${this.model}: inget verktygsanrop i svaret.`);
      return null;
    }
    const verdict = buildVerdict(toolUse.input as Record<string, unknown>);
    if (!verdict) {
      // RÅFÄLTEN HÖR HEMMA I LOGGEN: utan dem går det inte att se OM det är
      // modellen eller schemaöversättningen som brister vid ett byte.
      console.warn(
        `[deal-verify/claude] ${this.model}: otolkbart svar ${JSON.stringify(toolUse.input).slice(0, 300)}`
      );
    }
    return verdict;
  }
}
