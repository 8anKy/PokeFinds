/** TEMPORÄRT läs-bara: dumpa kortkatalogen (id, namn, nummer, set, bild-URL). */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const prisma = new PrismaClient();
// .spike/ är gitignorerad — repot är publikt och cachen blir hundratals MB.
const OUT = process.env.OUT ?? ".spike/cards.json";

async function main() {
  const cards = await prisma.card.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      number: true,
      rarity: true,
      imageUrl: true,
      set: { select: { name: true } },
    },
  });
  const withImg = cards.filter((c) => c.imageUrl);
  console.log(`kort totalt: ${cards.length} · med imageUrl: ${withImg.length}`);

  const hosts = new Map<string, number>();
  for (const c of withImg) {
    try {
      const h = new URL(c.imageUrl!).host;
      hosts.set(h, (hosts.get(h) ?? 0) + 1);
    } catch {
      hosts.set("OGILTIG URL", (hosts.get("OGILTIG URL") ?? 0) + 1);
    }
  }
  console.log("\nvärdar:");
  for (const [h, n] of [...hosts].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${h}`);

  console.log("\nexempel-URL:er:");
  for (const c of withImg.slice(0, 5)) console.log(`  ${c.imageUrl}`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      withImg.map((c) => ({
        id: c.id,
        name: c.name,
        number: c.number,
        // Rariteten används för att skilja HELBILDSKORT från klassiskt ramade —
        // de två har helt olika träffsäkerhet och snittet döljer skillnaden.
        rarity: c.rarity,
        set: c.set.name,
        url: c.imageUrl,
      })),
      null,
      0
    )
  );
  console.log(`\nskrev ${withImg.length} kort → ${OUT}`);
}

main().finally(() => prisma.$disconnect());
