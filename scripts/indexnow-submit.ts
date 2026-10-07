/**
 * Anmäler NYA sidor till Bing via IndexNow (src/lib/indexnow.ts).
 *
 * Nattligt som steg i cardmarket-refresh.yml (Neon är redan vaken där — aldrig egen cron):
 *   npx tsx scripts/indexnow-submit.ts                 # senaste 26 h (marginal mot jobbets drift)
 * Manuellt:
 *   node scripts/with-prod-db.mjs npx tsx scripts/indexnow-submit.ts --since-hours=168 --dry
 *   npx tsx scripts/indexnow-submit.ts --urls=https://foilio.se/discord,https://foilio.se/om
 *
 * Urvalet speglar sitemapen (src/app/sitemap.ts): synliga produkter, set med minst en
 * synlig produkt, guider vars `updatedAt` ligger i fönstret. ⛔ Aldrig hela katalogen —
 * se filhuvudet i lib/indexnow.ts.
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

import { prisma } from "../src/lib/db";
import { exitJob } from "../src/lib/job-exit";
import { NOT_HIDDEN } from "../src/lib/product-visibility";
import { GUIDES } from "../src/content/guides";
import { buildIndexNowPayloads, submitIndexNow } from "../src/lib/indexnow";

// ⛔ Inte NEXT_PUBLIC_APP_URL: lokalt pekar den på localhost, och IndexNow gäller bara
// den publika domänen. SITE_URL är samma repo-variabel som workflowens curl-steg läser.
const BASE_URL = process.env.SITE_URL || "https://foilio.se";
const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dry = process.argv.includes("--dry");

async function collect(): Promise<string[]> {
  const explicit = arg("urls");
  if (explicit) return explicit.split(",").map((u) => u.trim()).filter(Boolean);

  const hours = Number(arg("since-hours") ?? 26);
  const since = new Date(Date.now() - hours * 3600_000);
  const [products, sets] = await Promise.all([
    prisma.product.findMany({
      where: { ...NOT_HIDDEN, createdAt: { gte: since } },
      select: { slug: true },
    }),
    prisma.cardSet.findMany({
      where: { createdAt: { gte: since }, products: { some: { ...NOT_HIDDEN } } },
      select: { id: true },
    }),
  ]);
  // Guidernas datum är en dag (YYYY-MM-DD) — jämför på dygnsnivå i UTC.
  const sinceDay = since.toISOString().slice(0, 10);
  const guides = GUIDES.filter((g) => g.updatedAt >= sinceDay);

  const urls = [
    ...products.map((p) => `${BASE_URL}/produkter/${p.slug}`),
    ...sets.map((s) => `${BASE_URL}/sets/${s.id}`),
    ...guides.map((g) => `${BASE_URL}/guider/${g.slug}`),
  ];
  // Navsidorna listar det nya — anmäl dem när något tillkommit.
  if (sets.length > 0) urls.push(`${BASE_URL}/sets`);
  if (guides.length > 0) urls.push(`${BASE_URL}/guider`);
  console.log(
    `[indexnow] fönster ${hours} h: ${products.length} produkter, ${sets.length} set, ${guides.length} guider`
  );
  return urls;
}

async function main() {
  const urls = await collect();
  const payloads = buildIndexNowPayloads(BASE_URL, urls);
  const total = payloads.reduce((n, p) => n + p.urlList.length, 0);
  if (total === 0) {
    console.log("[indexnow] inget nytt att anmäla");
    return;
  }
  if (dry) {
    console.log(`[indexnow] TORRKÖRNING — ${total} URL:er, t.ex.:`, payloads[0].urlList.slice(0, 10));
    return;
  }
  const { sent, errors } = await submitIndexNow(payloads);
  console.log(`[indexnow] anmälde ${sent} av ${total} URL:er`);
  if (errors.length > 0) {
    for (const e of errors) console.log(`::warning::IndexNow: ${e}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(() => void exitJob(Number(process.exitCode ?? 0)));
