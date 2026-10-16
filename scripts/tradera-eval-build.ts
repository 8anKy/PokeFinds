/** Bygger .spike/tradera-eval/dataset.json: AI-domar (TraderaMatch) + annonsens titel + beskrivning (GetItem). */
import "./load-env";
import { requireEnv } from "./load-env";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { mapPool } from "../src/lib/concurrency";
import { fetchTraderaItem } from "../src/jobs/verify-deals";

requireEnv("TRADERA_APP_ID", "TRADERA_APP_KEY", "DATABASE_URL");
const OUT = path.join(process.cwd(), ".spike", "tradera-eval");
const FILE = path.join(OUT, "dataset.json");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const prev: Record<string, unknown>[] = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : [];
  const done = new Set(prev.map((r) => `${r.itemId}|${r.productId}`));
  const rows = await prisma.$queryRawUnsafe<
    { itemId: string; productId: string; ok: boolean; reason: string; checkedAt: Date; title: string; category: string; listingTitle: string | null }[]
  >(`
    with r as (select reason, count(*) c from "TraderaMatch" group by reason),
    ai as (select t.* from "TraderaMatch" t join r on r.reason = t.reason where r.c <= 3)
    select ai."itemId", ai."productId", ai.ok, ai.reason, ai."checkedAt", p.title, p.category::text as category, null as "listingTitle"
    from ai join "Product" p on p.id = ai."productId"
    where p.category not in ('SINGLE_CARD','GRADED_CARD','ACCESSORY','OTHER')`);
  const todo = rows.filter((r) => !done.has(`${r.itemId}|${r.productId}`));
  console.log(`AI-domar på sealed: ${rows.length} · redan hämtade ${done.size} · att hämta ${todo.length}`);
  const out = [...prev];
  let fetched = 0, missing = 0;
  await mapPool(todo, 3, async (r) => {
    const item = await fetchTraderaItem(r.itemId, process.env.TRADERA_APP_ID!, process.env.TRADERA_APP_KEY!);
    if (!item) { missing++; out.push({ ...r, description: null, fetchedTitle: null }); return; }
    fetched++;
    out.push({ ...r, description: item.description, fetchedTitle: item.title, ended: item.ended });
    if ((fetched + missing) % 200 === 0) {
      fs.writeFileSync(FILE, JSON.stringify(out));
      console.log(`  ${fetched + missing}/${todo.length} (saknas ${missing})`);
    }
  });
  fs.writeFileSync(FILE, JSON.stringify(out));
  console.log(`klart: ${out.length} rader · hämtade ${fetched} · gick inte att hämta ${missing} → ${FILE}`);
}
main().finally(() => prisma.$disconnect());
