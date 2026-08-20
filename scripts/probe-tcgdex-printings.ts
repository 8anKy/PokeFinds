/**
 * Facit för TRYCKNINGAR: jämför vår produktkatalogs reverse holo-täckning mot
 * TCGdex (gratis, MIT), som publicerar `cardCount.reverse` per set och
 * `variants: { normal, reverse, holo, firstEdition }` per kort.
 *
 * Avgör om en MASTER SET-nämnare kan bli ÄRLIG. Läser bara.
 */
import { prisma } from "../src/lib/db";
import { mapPool } from "../src/lib/concurrency";

const BASE = "https://api.tcgdex.net/v2/en";
const UA = "FoilioBot/1.0 (+https://foilio.se; katalogrevision)";

interface DexSet {
  id: string;
  name: string;
  cardCount: { total: number; official: number; reverse?: number; holo?: number; normal?: number; firstEd?: number };
}

async function getJson<T>(url: string): Promise<T | null> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  return (await r.json()) as T;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

async function main() {
  const list = (await getJson<DexSet[]>(`${BASE}/sets`)) ?? [];
  // ⛔ Pokémon TCG Pocket-set delar namn med riktiga set — de har inga fysiska
  // tryckningar och får aldrig bli facit. De ligger under serien "tcgp".
  // mapPool returnerar void — samla i en förallokerad array (index bevarar ordningen).
  const fetched: (DexSet & { serie?: { id: string } } | null)[] = new Array(list.length).fill(null);
  await mapPool(list, 8, async (s, i) => {
    fetched[i] = await getJson<DexSet & { serie?: { id: string } }>(`${BASE}/sets/${s.id}`);
  });
  const details = fetched.filter((s): s is DexSet & { serie?: { id: string } } => s != null);
  const physical = details.filter((s) => s.serie?.id !== "tcgp");
  console.log(`TCGdex: ${list.length} set, ${details.length} hämtade, ${physical.length} fysiska (tcgp bortfiltrerade).`);

  const byName = new Map<string, (DexSet & { serie?: { id: string } })[]>();
  for (const s of physical) {
    const k = norm(s.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(s);
  }

  const sets = await prisma.cardSet.findMany({
    where: { language: "EN" },
    select: { id: true, name: true, releaseDate: true, totalCards: true, _count: { select: { cards: true } } },
    orderBy: { releaseDate: "desc" },
  });
  const rhProducts = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", cardId: { not: null }, variantLabel: { contains: "Reverse", mode: "insensitive" } },
    select: { cardId: true, setId: true },
  });
  const rhBySet = new Map<string, Set<string>>();
  for (const p of rhProducts) {
    if (!p.setId) continue;
    if (!rhBySet.has(p.setId)) rhBySet.set(p.setId, new Set());
    rhBySet.get(p.setId)!.add(p.cardId!);
  }

  let matched = 0, exact = 0, weHaveFewer = 0, weHaveMore = 0, unmatched = 0;
  let dexReverseTotal = 0, ourReverseTotal = 0;
  const problems: string[] = [];
  const unmatchedNames: string[] = [];

  for (const s of sets) {
    const cands = byName.get(norm(s.name)) ?? [];
    // Namnkrock löses på KORTANTAL, inte på gissning.
    const dex =
      cands.find((c) => c.cardCount.total === s._count.cards) ??
      cands.find((c) => c.cardCount.official === s.totalCards) ??
      (cands.length === 1 ? cands[0] : undefined);
    if (!dex) {
      unmatched++;
      unmatchedNames.push(`${s.name} (kort=${s._count.cards}, printed=${s.totalCards}) kandidater=${cands.length}`);
      continue;
    }
    matched++;
    const dexRev = dex.cardCount.reverse ?? 0;
    const ourRev = rhBySet.get(s.id)?.size ?? 0;
    dexReverseTotal += dexRev;
    ourReverseTotal += ourRev;
    if (ourRev === dexRev) exact++;
    else if (ourRev < dexRev) { weHaveFewer++; problems.push(`  -${dexRev - ourRev}  ${s.name}: vi ${ourRev} / facit ${dexRev}  (kort ${s._count.cards} / facit ${dex.cardCount.total}) [${dex.id}]`); }
    else { weHaveMore++; problems.push(`  +${ourRev - dexRev}  ${s.name}: vi ${ourRev} / facit ${dexRev}  (kort ${s._count.cards} / facit ${dex.cardCount.total}) [${dex.id}]`); }
  }

  console.log(JSON.stringify({ ourEnSets: sets.length, matched, unmatched, exact, weHaveFewer, weHaveMore, dexReverseTotal, ourReverseTotal }, null, 2));
  console.log("\n=== AVVIKELSER (reverse holo: vi vs TCGdex) ===");
  for (const p of problems.sort((a, b) => Math.abs(parseInt(b)) - Math.abs(parseInt(a)))) console.log(p);
  console.log("\n=== OMATCHADE SET (" + unmatched + ") ===");
  for (const u of unmatchedNames) console.log("  " + u);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
