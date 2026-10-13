/**
 * Giveawayns dragning (lib/giveaway.ts + lib/giveaway-draw.ts).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/giveaway-draw.ts [--seed <text>] [--count 16] [--out <fil>]
 *
 * Räknar varje anmäld deltagares lotter vid giveawayns SLUT (closesAt, eller nu om
 * den pågår — då är det en provdragning) och drar `--count` deltagare viktat.
 * Ordningen = vinnaren, andraprisen, sedan reserver: uppfyller någon inte kraven
 * (följer, kommentar + 2 taggar) — hoppa till nästa i listan.
 *
 * ⛔ Samma seed + samma deltagare = samma utfall. Seeden skrivs ut; spara den
 * med loggen så dragningen kan visas i efterhand.
 * ⛔ Loggen bär e-post och namn ⇒ den skrivs till OS:ets temp-katalog som
 * standard, ALDRIG i repot.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/lib/db";
import { mapPool } from "../src/lib/concurrency";
import { exitJob } from "../src/lib/job-exit";
import { giveawayConfig, giveawayPhase } from "../src/lib/giveaway";
import { drawWinners } from "../src/lib/giveaway-draw";
import { loadUserTickets } from "../src/services/giveaway";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cfg = giveawayConfig();
  const now = new Date();
  const phase = giveawayPhase(cfg, now);
  const seed = arg("seed") ?? randomBytes(16).toString("hex");
  const count = Number(arg("count") ?? 16); // 1 vinnare + 5 andrapris + 10 reserver
  const out = arg("out") ?? join(tmpdir(), `giveaway-${cfg.key}-${now.toISOString().replace(/[:.]/g, "-")}.json`);

  console.log(`Giveaway ${cfg.key} · ${phase}${phase !== "closed" ? " (PROVDRAGNING — pågår fortfarande)" : ""}`);

  const entries = await prisma.giveawayEntry.findMany({
    where: { giveaway: cfg.key },
    select: {
      userId: true,
      tiktokHandle: true,
      instagramHandle: true,
      user: { select: { name: true, email: true } },
    },
  });

  const scored: Array<{
    id: string;
    tickets: number;
    name: string | null;
    email: string;
    tiktok: string | null;
    instagram: string | null;
    breakdown: unknown;
  }> = [];
  await mapPool(entries, 8, async (e) => {
    const t = await loadUserTickets(e.userId, cfg, now);
    scored.push({
      id: e.userId,
      tickets: t.tickets.total,
      name: e.user.name,
      email: e.user.email,
      tiktok: e.tiktokHandle,
      instagram: e.instagramHandle,
      breakdown: t.tickets,
    });
  });

  const total = scored.reduce((n, s) => n + s.tickets, 0);
  const winners = drawWinners(scored, seed, count);

  console.log(`Deltagare: ${scored.length} · lotter: ${total} · seed: ${seed}\n`);
  winners.forEach((w, i) => {
    const role = i === 0 ? "VINNARE" : i <= 5 ? "andrapris" : "reserv";
    console.log(
      `${String(i + 1).padStart(2)}. ${role.padEnd(9)} ${String(w.tickets).padStart(3)} lotter  ` +
        `${w.name ?? "–"} <${w.email}>  TikTok @${w.tiktok ?? "–"} · IG @${w.instagram ?? "–"}`
    );
  });

  writeFileSync(
    out,
    JSON.stringify(
      {
        giveaway: cfg.key,
        drawnAt: now.toISOString(),
        phase,
        countedUntil: (phase === "closed" ? cfg.closesAt : now).toISOString(),
        seed,
        participants: scored.length,
        totalTickets: total,
        winners: winners.map((w) => w.id),
        entries: scored.sort((a, b) => b.tickets - a.tickets),
      },
      null,
      2
    )
  );
  console.log(`\nLogg: ${out}`);
}

main()
  .then(() => exitJob(0))
  .catch(async (e) => {
    console.error(e);
    await exitJob(1);
  });
