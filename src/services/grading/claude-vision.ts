/**
 * Riktig kortgradering via Claude vision (Anthropic SDK). Skickar fram- och
 * baksidesbild i full upplösning och tvingar ett strukturerat svar genom ett
 * obligatoriskt verktyg (`report_grade`) — robustare än fritextparsning.
 *
 * Modellen väljs av anroparen (billig modell för FREE, starkare för PREMIUM).
 * Bilder skickas i hög upplösning eftersom yt-/kant-/hörndefekter annars är
 * osynliga.
 *
 * ⛔ Prompt, fältspec, bildetiketter och svarstolkning kommer ur `contract.ts` —
 * samma som Gemini-adaptern. Utan det jämför en A/B-körning prompter i stället
 * för modeller.
 *
 * Kräver ANTHROPIC_API_KEY. Detta är en AI-uppskattning, inte en officiell
 * PSA-/BGS-gradering — vilket system-prompten är tydlig med.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ServiceError } from "@/lib/errors";
import {
  GRADE_FIELDS,
  GRADE_REQUIRED,
  GRADE_TOOL_DESCRIPTION,
  GRADE_TOOL_NAME,
  IMAGE_LABEL_BACK,
  IMAGE_LABEL_FRONT,
  buildSystem,
  buildClosingInstruction,
  resolveGradingLocale,
  buildGradeResult,
  parseGradingImage,
} from "@/services/grading/contract";
import type { GradeResult, GradingAdapter, GradingContext } from "./types";

const GRADE_TOOL: Anthropic.Tool = {
  name: GRADE_TOOL_NAME,
  description: GRADE_TOOL_DESCRIPTION,
  input_schema: {
    type: "object",
    // ⛔ Fälten byggs ur den DELADE specen (contract.ts) — aldrig en egen kopia
    // här. Två leverantörer med var sin fältbeskrivning gör en A/B-mätning
    // meningslös: då jämför man prompter, inte modeller.
    properties: Object.fromEntries(
      GRADE_FIELDS.map((f) => [
        f.name,
        f.enum
          ? { type: f.type, enum: f.enum, description: f.description }
          : { type: f.type, description: f.description },
      ])
    ),
    required: GRADE_REQUIRED,
  },
};

export class ClaudeVisionGradingAdapter implements GradingAdapter {
  name = "claude";

  constructor(private readonly model: string) {}

  async grade(
    frontDataUrl: string,
    backDataUrl: string,
    context?: GradingContext
  ): Promise<GradeResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ServiceError(
        503,
        "AI-gradering är inte konfigurerad (ANTHROPIC_API_KEY saknas)."
      );
    }
    const client = new Anthropic({ apiKey });
    const front = parseGradingImage(frontDataUrl);
    const back = parseGradingImage(backDataUrl);

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: buildSystem(resolveGradingLocale(context?.locale)),
      tools: [GRADE_TOOL],
      tool_choice: { type: "tool", name: GRADE_TOOL_NAME },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: IMAGE_LABEL_FRONT },
            {
              type: "image",
              source: { type: "base64", media_type: front.mediaType, data: front.data },
            },
            { type: "text", text: IMAGE_LABEL_BACK },
            {
              type: "image",
              source: { type: "base64", media_type: back.mediaType, data: back.data },
            },
            { type: "text", text: buildClosingInstruction(context?.cardName) },
          ],
        },
      ],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) {
      throw new ServiceError(502, "Graderingen kunde inte tolkas. Försök igen.");
    }
    // ⛔ ALL tolkning i den DELADE buildGradeResult — se contract.ts.
    return buildGradeResult(toolUse.input as Record<string, unknown>, this.model, {
      // API:ts egna tokental → kostnaden per gradering är en MÄTNING.
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }
}
