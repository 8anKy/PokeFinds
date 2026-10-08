/**
 * Haiku 4.5 mot Haiku 5.5 på våra TVÅ LLM-domar, med samma prompt och samma
 * tolkning som i drift. Skriver INGENTING till databasen.
 *
 *   A. Tradera-verifieringen (`ClaudeDealVerifyAdapter`): sparade TraderaMatch-par
 *      (fällda + godkända), annonsen hämtas om via GetItem — domen sparar bara
 *      titeln, och beskrivningen är halva underlaget ("tom ask", "öppnad").
 *   B. Produktdomaren (`judgeSameProduct`): sparade DedupeVerdict-par.
 *
 * Facit = den sparade domen (fattad av Haiku 4.5). Rapporten visar båda modellernas
 * träff mot facit, var de är oense, och uppmätt kostnad ur `usage`.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/compare-haiku-models.ts [--a=120] [--b=150] [--only=a|b]
 */
import "./load-env";
import { requireEnv } from "./load-env";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../src/lib/db";
import { mapPool } from "../src/lib/concurrency";
import { priceForModel } from "../src/lib/ai-pricing";
import { judgeSameProduct } from "../src/lib/same-product";
import { ClaudeDealVerifyAdapter } from "../src/services/deal-verify/claude";
import { fetchTraderaItem } from "../src/jobs/verify-deals";
import type { DealVerification } from "../src/services/deal-verify/contract";

requireEnv("ANTHROPIC_API_KEY", "TRADERA_APP_ID", "TRADERA_APP_KEY", "DATABASE_URL");

const MODELS = ["claude-haiku-4-5-20251001", "claude-haiku-5-5"] as const;
type Model = (typeof MODELS)[number];

function arg(name: string, def: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = hit ? parseInt(hit.split("=")[1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}
const N_A = arg("a", 120);
const N_B = arg("b", 150);

/** En klient per modell som räknar tokens och stop_reason ur varje svar. */
interface Tally { input: number; output: number; calls: number; stops: Record<string, number> }
function countingClient(t: Tally): Anthropic {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const orig = client.messages.create.bind(client.messages);
  (client.messages as unknown as { create: unknown }).create = async (...args: unknown[]) => {
    const r = (await (orig as (...a: unknown[]) => Promise<Anthropic.Message>)(...args)) as Anthropic.Message;
    t.input += r.usage.input_tokens;
    t.output += r.usage.output_tokens;
    t.calls++;
    const s = r.stop_reason ?? "null";
    t.stops[s] = (t.stops[s] ?? 0) + 1;
    return r;
  };
  return client;
}
const tallies = Object.fromEntries(
  MODELS.map((m) => [m, { input: 0, output: 0, calls: 0, stops: {} } as Tally])
) as Record<Model, Tally>;
const clients = Object.fromEntries(MODELS.map((m) => [m, countingClient(tallies[m])])) as Record<Model, Anthropic>;

function usd(m: Model, t: Tally): number {
  const p = priceForModel(m);
  return p ? (t.input * p.inputPerMTok + t.output * p.outputPerMTok) / 1e6 : NaN;
}

/** Hälften fällda, hälften godkända — facit är skevt (de flesta par godkänns). */
function balanced<T extends { ok: boolean }>(rows: T[], n: number): T[] {
  const shuffle = (a: T[]) => a.map((x) => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const neg = shuffle(rows.filter((r) => !r.ok)).slice(0, Math.ceil(n / 2));
  const pos = shuffle(rows.filter((r) => r.ok)).slice(0, n - neg.length);
  return [...neg, ...pos];
}

async function partA() {
  // Samma urval som `verifyTraderaMatches` dömer i dag: bara sealed. Gamla par mot
  // singlar finns kvar i tabellen men når aldrig domaren längre.
  const sealedIds = new Set(
    (await prisma.product.findMany({
      where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY", "OTHER"] } },
      select: { id: true },
    })).map((p) => p.id)
  );
  const matches = (await prisma.traderaMatch.findMany({
    where: { NOT: { reason: "Annonsen avslutad" } },
    select: { itemId: true, productId: true, ok: true, reason: true },
  })).filter((m) => sealedIds.has(m.productId));
  const sample = balanced(matches, N_A);
  const products = new Map(
    (await prisma.product.findMany({
      where: { id: { in: sample.map((s) => s.productId) } },
      select: { id: true, title: true, category: true },
    })).map((p) => [p.id, p])
  );
  const adapters = Object.fromEntries(
    MODELS.map((m) => [m, new ClaudeDealVerifyAdapter(m, clients[m])])
  ) as Record<Model, ClaudeDealVerifyAdapter>;

  type Row = { itemId: string; title: string; listing: string; facit: boolean; facitReason: string | null; v: Record<Model, DealVerification | null> };
  const rows: Row[] = [];
  let noItem = 0;
  await mapPool(sample, 3, async (s) => {
    const product = products.get(s.productId);
    if (!product) return;
    const item = await fetchTraderaItem(s.itemId, process.env.TRADERA_APP_ID!, process.env.TRADERA_APP_KEY!);
    if (!item || !item.title) {
      noItem++;
      return;
    }
    const v = {} as Record<Model, DealVerification | null>;
    for (const m of MODELS) {
      try {
        v[m] = await adapters[m].verify(
          { title: product.title, category: product.category },
          { title: item.title, description: item.description }
        );
      } catch (err) {
        console.warn(`[A] ${m} ${s.itemId}:`, err instanceof Error ? err.message : err);
        v[m] = null;
      }
    }
    rows.push({ itemId: s.itemId, title: product.title, listing: item.title, facit: s.ok, facitReason: s.reason, v });
  });
  report("A. Tradera-verifiering", rows.map((r) => ({
    label: `${r.listing}  →  ${r.title}`,
    facit: r.facit,
    facitReason: r.facitReason,
    out: Object.fromEntries(MODELS.map((m) => {
      const x = r.v[m];
      return [m, x ? { ok: x.sameProduct && x.sealedComplete, reason: x.reason } : null];
    })) as Record<Model, { ok: boolean; reason: string } | null>,
  })));
  if (noItem) console.log(`   (${noItem} annonser gick inte att hämta från Tradera — utelämnade)`);
}

async function partB() {
  const verdicts = await prisma.dedupeVerdict.findMany({ select: { titleA: true, titleB: true, same: true } });
  const sample = balanced(verdicts.map((v) => ({ ...v, ok: v.same })), N_B);
  const rows: Array<{ label: string; facit: boolean; facitReason: null; out: Record<Model, { ok: boolean; reason: string } | null> }> = [];
  await mapPool(sample, 3, async (s) => {
    const out = {} as Record<Model, { ok: boolean; reason: string } | null>;
    for (const m of MODELS) {
      const v = await judgeSameProduct(s.titleA, s.titleB, undefined, { model: m, client: clients[m] });
      out[m] = v ? { ok: v.same, reason: v.reason } : null;
    }
    rows.push({ label: `${s.titleA}  ⇔  ${s.titleB}`, facit: s.ok, facitReason: null, out });
  });
  report("B. Produktdomaren (dedupe)", rows);
}

function report(
  name: string,
  rows: Array<{ label: string; facit: boolean; facitReason: string | null; out: Record<Model, { ok: boolean; reason: string } | null> }>
) {
  console.log(`\n════ ${name}: ${rows.length} par (${rows.filter((r) => !r.facit).length} fällda i facit) ════`);
  for (const m of MODELS) {
    const answered = rows.filter((r) => r.out[m]);
    const agree = answered.filter((r) => r.out[m]!.ok === r.facit).length;
    const falsePos = answered.filter((r) => r.out[m]!.ok && !r.facit).length;
    const falseNeg = answered.filter((r) => !r.out[m]!.ok && r.facit).length;
    console.log(
      `  ${m.padEnd(26)} träff ${agree}/${answered.length}` +
        `  · godkände fällda ${falsePos}  · fällde godkända ${falseNeg}  · ingen dom ${rows.length - answered.length}`
    );
  }
  const [old, neu] = MODELS;
  const split = rows.filter((r) => r.out[old] && r.out[neu] && r.out[old]!.ok !== r.out[neu]!.ok);
  console.log(`  Oense sinsemellan: ${split.length}`);
  for (const r of split) {
    console.log(`   • ${r.label}`);
    console.log(`       facit ${r.facit ? "OK " : "NEJ"}${r.facitReason ? ` (${r.facitReason})` : ""}`);
    for (const m of MODELS) console.log(`       ${m.slice(7, 16)} ${r.out[m]!.ok ? "OK " : "NEJ"} ${r.out[m]!.reason}`);
  }
}

async function main() {
  const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
  if (only !== "b") await partA();
  if (only !== "a") await partB();
  console.log("\n════ Kostnad (uppmätt ur usage) ════");
  for (const m of MODELS) {
    const t = tallies[m];
    console.log(
      `  ${m.padEnd(26)} ${t.calls} anrop · in ${t.input} · ut ${t.output} tok · $${usd(m, t).toFixed(4)}` +
        ` · per anrop $${(usd(m, t) / Math.max(1, t.calls)).toFixed(6)} · stopp ${JSON.stringify(t.stops)}`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
