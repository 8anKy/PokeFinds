/**
 * Fynd-verifiering (Pro-only "Fynd"-feed).
 *
 * Fynd-feeden lyfter fram Tradera-annonser långt under sitt Cardmarket-pris — men
 * den lyfter DÄRMED fram de sämsta matchningarna (fel produkt = störst "rabatt"),
 * plus tomma/skadade varor och utgångna annonser. Bigram-matchningen kan inte skilja
 * mall-namngivna sealed-produkter åt ("Palkia VSTAR Premium" vs "Arceus VSTAR Premium").
 *
 * Kandidatmängden är LITEN (tiotal) → vi har råd med ett dyrt, exakt anrop per annons:
 * hämta Tradera-annonsens fulla beskrivning (GetItem) och låt Claude Haiku avgöra om det
 * VERKLIGEN är samma sealed produkt OCH att den är komplett/oöppnad/oskadad. Resultatet
 * cachas i DealCheck (per offer + pris) så vi bara omverifierar när priset ändras.
 *
 * Kräver TRADERA_APP_ID/TRADERA_APP_KEY + ANTHROPIC_API_KEY. Körs sist i tradera-sweepen.
 */
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { mapPool } from "@/lib/concurrency";
import { dealCandidateOffers, DEAL_MIN_DISCOUNT, DEAL_MAX_DISCOUNT } from "@/services/products";

const PUBLIC_API = "https://api.tradera.com/v3/publicservice.asmx";
const VERIFY_MODEL = process.env.DEALS_VERIFY_MODEL ?? "claude-haiku-4-5-20251001";

/** Tradera-itemId ur en annons-URL (`/item/{cat}/{itemId}/slug`). Null om okänd form. */
export function extractTraderaItemId(url: string): string | null {
  const m = /\/item\/\d+\/(\d+)/.exec(url);
  return m ? m[1] : null;
}

/** Slår ihop delbesluten till ett fynd-verdikt. Ren → testbar. */
export function dealVerdict(v: {
  sameProduct: boolean;
  sealedComplete: boolean;
  ended: boolean;
  remaining: number;
}): boolean {
  return v.sameProduct && v.sealedComplete && !v.ended && v.remaining > 0;
}

interface TraderaItemDetail {
  title: string;
  description: string;
  ended: boolean;
  remaining: number;
  endsAt: Date | null;
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!m) return "";
  return m[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hämtar en Tradera-annons fulla detaljer via PublicService.GetItem. */
export async function fetchTraderaItem(
  itemId: string,
  appId: string,
  appKey: string
): Promise<TraderaItemDetail | null> {
  const header = `<soap:Header><trad:AuthenticationHeader><trad:AppId>${appId}</trad:AppId><trad:AppKey>${appKey}</trad:AppKey></trad:AuthenticationHeader><trad:ConfigurationHeader><trad:Sandbox>0</trad:Sandbox><trad:MaxResultAge>0</trad:MaxResultAge></trad:ConfigurationHeader></soap:Header>`;
  const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:trad="http://api.tradera.com">${header}<soap:Body><trad:GetItem><trad:itemId>${itemId}</trad:itemId></trad:GetItem></soap:Body></soap:Envelope>`;
  const res = await fetch(`${PUBLIC_API}?appId=${appId}&appKey=${appKey}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"http://api.tradera.com/GetItem"` },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const xml = await res.text();
  if (xml.includes("<faultstring>")) return null;
  const endRaw = tag(xml, "EndDate");
  const endsAt = endRaw ? new Date(endRaw) : null;
  return {
    title: tag(xml, "ShortDescription"),
    description: tag(xml, "LongDescription"),
    ended: tag(xml, "Ended").toLowerCase() === "true",
    remaining: parseInt(tag(xml, "RemainingQuantity") || "1", 10) || 0,
    endsAt: endsAt && !isNaN(endsAt.getTime()) ? endsAt : null,
  };
}

const SYSTEM = [
  "Du verifierar om en svensk Tradera-annons matchar en katalogprodukt (Pokémon TCG sealed-produkt).",
  "Avgör TVÅ saker:",
  "1. sameProduct: är annonsen EXAKT samma produkt som katalogposten? Var strikt på varianter —",
  "   'Prismatic Evolutions' ≠ 'Evolutions', 'Ultra-Premium' ≠ 'Premium', olika Pokémon (Palkia ≠ Arceus),",
  "   1-pack ≠ 3-pack blister, japansk ≠ engelsk. Vid minsta tvekan: false.",
  "2. sealedComplete: är varan komplett, oöppnad och oskadad enligt titel + beskrivning?",
  "   false om tom ask, endast asken, öppnad, skadad, trasig, defekt, kopia/proxy, eller saknade delar.",
  "Ge en KORT motivering på svenska. Anropa alltid report_verification.",
].join(" ");

const VERIFY_TOOL: Anthropic.Tool = {
  name: "report_verification",
  description: "Rapportera verifieringen av Tradera-annonsen mot katalogprodukten.",
  input_schema: {
    type: "object",
    properties: {
      sameProduct: { type: "boolean", description: "Exakt samma produkt/variant?" },
      sealedComplete: { type: "boolean", description: "Komplett, oöppnad, oskadad?" },
      reason: { type: "string", description: "Kort motivering på svenska." },
    },
    required: ["sameProduct", "sealedComplete", "reason"],
  },
};

async function verifyMatch(
  client: Anthropic,
  product: { title: string; category: string; refKr: number },
  listing: { title: string; description: string }
): Promise<{ sameProduct: boolean; sealedComplete: boolean; reason: string }> {
  const response = await client.messages.create({
    model: VERIFY_MODEL,
    max_tokens: 512,
    system: SYSTEM,
    tools: [VERIFY_TOOL],
    tool_choice: { type: "tool", name: "report_verification" },
    messages: [
      {
        role: "user",
        content:
          `KATALOGPRODUKT:\nTitel: ${product.title}\nKategori: ${product.category}\nUngefärligt marknadspris: ${product.refKr} kr\n\n` +
          `TRADERA-ANNONS:\nTitel: ${listing.title}\nBeskrivning: ${listing.description || "(ingen beskrivning)"}\n\n` +
          `Är annonsen exakt samma produkt, och är den komplett/oöppnad/oskadad? Anropa report_verification.`,
      },
    ],
  });
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  const input = (toolUse?.input ?? {}) as Record<string, unknown>;
  return {
    sameProduct: input.sameProduct === true,
    sealedComplete: input.sealedComplete === true,
    reason: typeof input.reason === "string" ? input.reason.slice(0, 200) : "",
  };
}

export interface VerifyDealsResult {
  candidates: number;
  verified: number;
  ok: number;
  rejected: number;
  skipped: number;
}

/**
 * Verifierar alla fynd-kandidater som saknar färsk DealCheck (eller vars pris ändrats).
 * Sätter DealCheck.ok som fynd-feeden sedan filtrerar på.
 */
export async function verifyDeals(
  log: (msg: string) => void = console.log
): Promise<VerifyDealsResult> {
  const res: VerifyDealsResult = { candidates: 0, verified: 0, ok: 0, rejected: 0, skipped: 0 };
  const appId = process.env.TRADERA_APP_ID;
  const appKey = process.env.TRADERA_APP_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!appId || !appKey || !anthropicKey) {
    log("[verify-deals] saknar TRADERA_APP_ID/KEY eller ANTHROPIC_API_KEY — hoppar över.");
    return res;
  }
  const client = new Anthropic({ apiKey: anthropicKey });

  const candidates = await dealCandidateOffers();
  res.candidates = candidates.length;
  log(`[verify-deals] ${candidates.length} kandidater (rabatt ${Math.round(DEAL_MIN_DISCOUNT * 100)}–${Math.round(DEAL_MAX_DISCOUNT * 100)} %).`);

  // Redan färskt verifierade (samma pris, senaste dygnet) hoppas över.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = new Map(
    (
      await prisma.dealCheck.findMany({
        where: { offerId: { in: candidates.map((c) => c.offerId) } },
        select: { offerId: true, checkedPrice: true, checkedAt: true },
      })
    ).map((d) => [d.offerId, d])
  );

  await mapPool(candidates, 3, async (c) => {
    const prev = existing.get(c.offerId);
    if (prev && prev.checkedPrice === c.traderaPrice && prev.checkedAt >= dayAgo) {
      res.skipped++;
      return;
    }
    const itemId = extractTraderaItemId(c.traderaUrl);
    if (!itemId) {
      res.skipped++;
      return;
    }
    const item = await fetchTraderaItem(itemId, appId, appKey);
    if (!item) {
      res.skipped++;
      return;
    }

    let sameProduct = false;
    let sealedComplete = false;
    let reason = "";
    // Utgången/tom vara: hoppa över LLM-anropet helt.
    if (!item.ended && item.remaining > 0) {
      const v = await verifyMatch(
        client,
        { title: c.title, category: c.category, refKr: Math.round(c.cmPrice / 100) },
        { title: item.title, description: item.description }
      );
      sameProduct = v.sameProduct;
      sealedComplete = v.sealedComplete;
      reason = v.reason;
    } else {
      reason = "Annonsen avslutad";
    }

    const ok = dealVerdict({ sameProduct, sealedComplete, ended: item.ended, remaining: item.remaining });
    await prisma.dealCheck.upsert({
      where: { offerId: c.offerId },
      create: {
        offerId: c.offerId,
        ok,
        checkedPrice: c.traderaPrice,
        listingTitle: item.title || c.title,
        reason,
        endsAt: item.endsAt,
      },
      update: {
        ok,
        checkedPrice: c.traderaPrice,
        listingTitle: item.title || c.title,
        reason,
        endsAt: item.endsAt,
        checkedAt: new Date(),
      },
    });
    res.verified++;
    if (ok) res.ok++;
    else res.rejected++;
  });

  log(`[verify-deals] verifierade ${res.verified} (ok ${res.ok}, avvisade ${res.rejected}), hoppade ${res.skipped}.`);
  return res;
}
