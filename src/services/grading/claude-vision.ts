/**
 * Riktig kortgradering via Claude vision (Anthropic SDK). Skickar fram- och
 * baksidesbild i full upplösning och tvingar ett strukturerat svar genom ett
 * obligatoriskt verktyg (`report_grade`) — robustare än fritextparsning.
 *
 * Modellen väljs av anroparen (Haiku för FREE, Sonnet för PREMIUM). Bilder
 * skickas i hög upplösning eftersom yt-/kant-/hörndefekter annars är osynliga.
 *
 * Kräver ANTHROPIC_API_KEY. Detta är en AI-uppskattning, inte en officiell
 * PSA-/BGS-gradering — vilket system-prompten är tydlig med.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ServiceError } from "@/lib/errors";
import type { GradeResult, GradingAdapter, GradingContext } from "./types";

function parseDataUrl(dataUrl: string): {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
} {
  const m = /^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,(.+)$/i.exec(dataUrl);
  if (!m) {
    throw new ServiceError(
      400,
      "Bildformatet stöds inte för gradering. Använd JPG, PNG, WEBP eller GIF."
    );
  }
  const raw = m[1].toLowerCase();
  const mediaType = (raw === "image/jpg" ? "image/jpeg" : raw) as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";
  return { mediaType, data: m[2] };
}

const SYSTEM = [
  "Du är en expert på att bedöma skicket (condition) på Pokémon-samlarkort.",
  "Du får en framsidesbild och en baksidesbild av samma kort.",
  "Bedöm fyra kriterier på en skala 1–10 (10 = perfekt):",
  "- centering: hur centrerat trycket/ramen är (fram + bak).",
  "- corners: hörnens skick (vassa vs trubbiga/vita).",
  "- edges: kanternas skick (whitening, nötning, flisor).",
  "- surface: ytans skick (repor, fingeravtryck, print lines, scratches, dents).",
  "Sätt sedan en sammanvägd PSA-LIKNANDE helhetsgrad 1–10 (en decimal tillåten),",
  "samt en konfidens 0–1 utifrån bildkvaliteten, och en kort motivering på svenska.",
  "Var sträng och realistisk — de flesta kort hamnar mellan 6 och 9.",
  "Om bilderna är suddiga eller delvis skymda: sänk konfidensen.",
  "Detta är en UPPSKATTNING, inte en officiell PSA-/BGS-gradering.",
].join(" ");

const GRADE_TOOL: Anthropic.Tool = {
  name: "report_grade",
  description: "Rapportera den bedömda graderingen av kortet.",
  input_schema: {
    type: "object",
    properties: {
      centering: { type: "number", description: "1–10" },
      corners: { type: "number", description: "1–10" },
      edges: { type: "number", description: "1–10" },
      surface: { type: "number", description: "1–10" },
      overall: { type: "number", description: "Sammanvägd helhetsgrad 1–10" },
      confidence: { type: "number", description: "0–1" },
      rationale: { type: "string", description: "Kort motivering på svenska." },
    },
    required: [
      "centering",
      "corners",
      "edges",
      "surface",
      "overall",
      "confidence",
      "rationale",
    ],
  },
};

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(hi, Math.max(lo, v));
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
    const front = parseDataUrl(frontDataUrl);
    const back = parseDataUrl(backDataUrl);

    const hint = context?.cardName
      ? ` Kortet är troligen: ${context.cardName}.`
      : "";

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [GRADE_TOOL],
      tool_choice: { type: "tool", name: "report_grade" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Framsida:" },
            {
              type: "image",
              source: { type: "base64", media_type: front.mediaType, data: front.data },
            },
            { type: "text", text: "Baksida:" },
            {
              type: "image",
              source: { type: "base64", media_type: back.mediaType, data: back.data },
            },
            {
              type: "text",
              text:
                "Bedöm kortets skick och anropa report_grade med dina poäng." + hint,
            },
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
    const input = toolUse.input as Record<string, unknown>;

    const subScores = {
      centering: clamp(input.centering, 1, 10, 5),
      corners: clamp(input.corners, 1, 10, 5),
      edges: clamp(input.edges, 1, 10, 5),
      surface: clamp(input.surface, 1, 10, 5),
    };
    const overall = Math.round(clamp(input.overall, 1, 10, 5) * 10) / 10;

    return {
      overall,
      subScores,
      confidence: clamp(input.confidence, 0, 1, 0.5),
      rationale:
        typeof input.rationale === "string" && input.rationale.trim()
          ? input.rationale.trim()
          : "Ingen motivering tillgänglig.",
      modelUsed: this.model,
    };
  }
}
