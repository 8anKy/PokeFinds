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

const SYSTEM = [
  "Du identifierar Pokémon-samlarkort från EN bild eller videoruta.",
  "Läs kortets namn (t.ex. 'Charizard ex').",
  "SAMLARNUMRET ÄR AVGÖRANDE: många kort delar namn (t.ex. flera 'Wailord'),",
  "och numret är det enda som skiljer dem åt. Det står i regel i ett NEDRE HÖRN,",
  "ofta litet, som 'nummer/total' (t.ex. '41/159', '199/091') eller med set-kod",
  "(t.ex. 'SVP 041'). Returnera HELA strängen inklusive total efter snedstrecket —",
  "läs siffrorna tecken för tecken, gissa inte. Är numret oläsligt: lämna number tomt",
  "och sänk konfidensen (hellre tomt än fel nummer).",
  "Returnera en konfidens 0–1 utifrån hur tydligt kortet syns och hur säker du är.",
  "Om inget tydligt Pokémon-kort syns: sätt cardVisible=false och låg konfidens.",
].join(" ");

const CARD_TOOL: Anthropic.Tool = {
  name: "report_card",
  description: "Rapportera det identifierade kortet.",
  input_schema: {
    type: "object",
    properties: {
      cardVisible: { type: "boolean", description: "Syns ett Pokémon-kort tydligt i bilden?" },
      name: { type: "string", description: "Kortets namn, t.ex. 'Charizard ex'. Tom sträng om okänt." },
      number: { type: "string", description: "Samlarnummer MED total, t.ex. '41/159' eller '4/102' (läs nedre hörnet, hela strängen). Tom sträng om oläsligt." },
      confidence: { type: "number", description: "0–1" },
    },
    required: ["cardVisible", "name", "number", "confidence"],
  },
};

export class ClaudeVisionOcrAdapter implements OcrAdapter {
  readonly name = "claude";

  constructor(private readonly model: string) {}

  async extractCardInfo(imageDataUrl: string): Promise<OcrResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ServiceError(
        503,
        "Kortidentifiering är inte konfigurerad (ANTHROPIC_API_KEY saknas)."
      );
    }
    const client = new Anthropic({ apiKey });
    const img = parseDataUrl(imageDataUrl);

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 256,
      system: SYSTEM,
      tools: [CARD_TOOL],
      tool_choice: { type: "tool", name: "report_card" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: img.mediaType, data: img.data },
            },
            { type: "text", text: "Identifiera kortet och anropa report_card." },
          ],
        },
      ],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) {
      throw new ServiceError(502, "Kortet kunde inte tolkas. Försök igen.");
    }
    const input = toolUse.input as Record<string, unknown>;
    const cardVisible = input.cardVisible === true;
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const number = typeof input.number === "string" ? input.number.trim() : "";
    const confidence =
      typeof input.confidence === "number" && Number.isFinite(input.confidence)
        ? Math.min(1, Math.max(0, input.confidence))
        : 0.5;

    return {
      rawText: [name, number].filter(Boolean).join(" "),
      guessedName: cardVisible && name ? name : undefined,
      guessedNumber: cardVisible && number ? number : undefined,
      // Inget kort i bild → 0 så att UI:t inte låser på en slumpträff.
      confidence: cardVisible ? confidence : 0,
    };
  }
}
