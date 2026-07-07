/**
 * Delad LLM-dom: "är detta samma sealed-SKU?" (Haiku, ~2 titlar/anrop ≈ $0.001).
 * Används av (1) veckovisa stub-dedupen, (2) auto-importens gränsfall
 * (matchProduct 0.55–0.85: hellre en billig dom än en dubblettprodukt) och
 * (3) JP↔Cardmarket-mappningen. Utan ANTHROPIC_API_KEY → null (anroparen
 * faller tillbaka på sitt mekaniska beteende).
 */
import type Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.DEDUPE_MODEL ?? "claude-haiku-4-5-20251001";

const SYSTEM = [
  "Du avgör om två titlar beskriver SAMMA Pokémon TCG sealed-produkt (samma SKU).",
  "Titel A är en butiksannons, titel B en katalogprodukt. Svara same=false vid en KONKRET motsägelse:",
  "olika set/expansion, olika Pokémon/variant, olika produkttyp (pack ≠ box ≠ ETB ≠ tin ≠ blister ≠ bundle ≠ collection),",
  "olika antal (3-pack ≠ enkelpack, 18 ≠ 36 paket), 'Deluxe'/'Premium'/'Ultra-Premium' ≠ vanlig utgåva,",
  "Pokémon Center-utgåva ≠ vanlig utgåva, olika serienummer (Series 1 ≠ Series 2),",
  "OLIKA SPRÅK: japansk ≠ engelsk ≠ koreansk ≠ kinesisk utgåva är ALLTID olika produkter.",
  "Följande är INTE skillnader: era-/serieprefix (Scarlet & Violet, SV10.5, Mega Evolution m.fl. är setets familj),",
  "'Display' = 'Booster Box' (gäller boosterlådor), ordföljd/stavning/svenska vs engelska beskrivningsord, butiksbrus",
  "(t.ex. 'max 1 per kund', 'förhandsbokning', '(5 cards)', '(30 boosters)'). OBS: 'Mini Tin Display' är en LÅDA MED FLERA tins",
  "≠ en enskild mini tin — det ÄR en konkret motsägelse. Osäker UTAN konkret motsägelse: same=true.",
  "Anropa alltid report_same.",
].join(" ");

const SAME_TOOL = {
  name: "report_same",
  description: "Rapportera om titlarna avser samma produkt.",
  input_schema: {
    type: "object",
    properties: {
      same: { type: "boolean", description: "Samma SKU?" },
      reason: { type: "string", description: "Kort motivering på svenska." },
    },
    required: ["same", "reason"],
  },
} satisfies Anthropic.Tool;

// SDK:t importeras LAZY med webpackIgnore: modulen når Next-bundlen via
// runner/cardmarket-refresh (instrumentation → scheduler), och SDK:ts
// node:fs/node:path-imports kraschar annars webpack-bygget (Edge-chunk).
// Körs aldrig på Edge (runtime-vakt i instrumentation.ts).
let client: Anthropic | null | undefined;
async function getClient(): Promise<Anthropic | null> {
  if (client !== undefined) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    client = null;
    return client;
  }
  const mod = await import(/* webpackIgnore: true */ "@anthropic-ai/sdk");
  client = new mod.default({ apiKey });
  return client;
}

export interface SameVerdict {
  same: boolean;
  reason: string;
}

/**
 * Dömer om annons-titeln och katalogtiteln är samma SKU. `context` läggs till
 * i user-prompten (t.ex. "B är en japansk Cardmarket-produkt"). Returnerar null
 * när nyckel saknas ELLER anropet misslyckas — anroparen ska då bete sig som
 * utan LLM (aldrig kasta i skrap-/importloopar).
 */
export async function judgeSameProduct(
  listingTitle: string,
  catalogTitle: string,
  context?: string
): Promise<SameVerdict | null> {
  let c: Anthropic | null;
  try {
    c = await getClient();
  } catch (err) {
    console.warn("[same-product] SDK-laddning misslyckades:", err instanceof Error ? err.message : err);
    return null;
  }
  if (!c) return null;
  try {
    const response = await c.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: SYSTEM,
      tools: [SAME_TOOL],
      tool_choice: { type: "tool", name: "report_same" },
      messages: [
        {
          role: "user",
          content: `A (butiksannons): ${listingTitle}\nB (katalogprodukt): ${catalogTitle}\n${context ? context + "\n" : ""}\nSamma produkt? Anropa report_same.`,
        },
      ],
    });
    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const input = (toolUse?.input ?? {}) as Record<string, unknown>;
    return {
      same: input.same === true,
      reason: typeof input.reason === "string" ? input.reason.slice(0, 150) : "",
    };
  } catch (err) {
    console.warn("[same-product] LLM-dom misslyckades:", err instanceof Error ? err.message : err);
    return null;
  }
}
