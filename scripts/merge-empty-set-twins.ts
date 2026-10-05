/**
 * SLÅ IHOP KORTLÖSA SET-TVILLINGAR (2026-10-05).
 *
 * Två vägar hade skapat ett andra, KORTLÖST set bredvid det riktiga och hängt
 * sealed-produkterna där — setlistan visade alltså ett set "utan kort" som vi hade:
 *   EN: set-etiketten skapade "EX Ruby & Sapphire" ur CM-episoden eftersom
 *       pokemontcg.io heter "Ruby & Sapphire" (lagat i cmSetNameKeys).
 *   JP: jp-set-label skapar set ur CM:s expansioner ("Plasma Gale"), JP-singlarna
 *       skapade sina egna ur leverantören ("Plasma Gale (BW7)") — olika namn, ingen
 *       krok mellan dem.
 * Tabellen nedan är GRANSKAD för hand (namn + kod + sealed-titlarna i skalet); inget
 * matchas fuzzy vid körning. Skalet töms (produkter + bevakningar + cmExpansionId
 * flyttas till det riktiga setet) och raderas.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-empty-set-twins.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-empty-set-twins.ts --apply
 */
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

// [språk, skalets namn, det riktiga setets namn]
const PAIRS: [string, string, string][] = [
  ...[
    "Ruby & Sapphire", "Sandstorm", "Dragon", "Team Magma vs Team Aqua", "Hidden Legends",
    "FireRed & LeafGreen", "Team Rocket Returns", "Deoxys", "Emerald", "Unseen Forces",
    "Delta Species", "Legend Maker", "Holon Phantoms", "Crystal Guardians", "Dragon Frontiers",
    "Power Keepers",
  ].map((n): [string, string, string] => ["EN", `EX ${n}`, n]),
  ["JP", "Plasma Gale", "Plasma Gale (BW7)"],
  ["JP", "Cold Flare", "Cold Flare (BW6c)"],
  ["JP", "Freeze Bolt", "Freeze Bolt (BW6f)"],
  ["JP", "Dragon Blade", "Dragon Blade (BW5e)"],
  ["JP", "Dragon Blast", "Dragon Blast (BW5t)"],
  ["JP", "Dragon Selection", "Dragon Selection (DS)"],
  ["JP", "Dark Rush", "Dark Rush (BW4)"],
  ["JP", "Hail Blizzard", "Hail Blizzard (BW3h)"],
  ["JP", "Psycho Drive", "Psycho Drive (BW3p)"],
  ["JP", "Red", "Red Collection (BW2)"],
  ["JP", "Black", "Black Collection (BW1b)"],
  ["JP", "White", "White Collection (BW1w)"],
  ["JP", "Spiral Force", "Spiral Force (BW8s)"],
  ["JP", "Thunder Knuckle", "Thunder Knuckle (BW8t)"],
  ["JP", "Megalo Cannon", "Megalo Cannon (BW9)"],
  ["JP", "Shiny", "Shiny Collection (SHC)"],
  ["JP", "EX Battle Boost", "EX Battle Boost (EBB)"],
  ["JP", "Collection Sun", "Collection Sun (SM1S)"],
  ["JP", "Collection Moon", "Collection Moon (SM1M)"],
  ["JP", "Strength Expansion Pack Sun & Moon", "Sun & Moon Strengthening Expansion (SM2p)"],
  ["JP", "Alolan Moonlight", "Alola Moonlight (SM2L)"],
  ["JP", "Islands Await You", "Islands Awaiting You (SM2K)"],
  ["JP", "Facing a New Trial", "Strengthening Expansion Pack: Beyond A New Challenge (SM2p)"],
  ["JP", "To Have Seen the Battle Rainbow", "Seen the Rainbow Battle (SM3H)"],
  ["JP", "Darkness that Consumes Light", "Light-Consuming Darkness (SM3N)"],
  ["JP", "Shining Legends", "Strengthening Expansion: Shining Legends (SM3p)"],
  ["JP", "Awakened Heroes", "The Awoken Hero (SM4S)"],
  ["JP", "Ultradimensional Beasts", "The Transdimensional Beast (SM4A)"],
  ["JP", "GX Battle Boost", "GX Battle Boost (SM4p)"],
  ["JP", "Forbidden Light", "Forbidden Light (SM6)"],
  ["JP", "Champion Road", "Champion Road (SM6b)"],
  ["JP", "Sky-Splitting Charisma", "Charisma of the Cracked Sky (SM7)"],
  ["JP", "Thunderclap Spark", "Thunderclap Spark (SM7a)"],
  ["JP", "Super-Burst Impact", "Super-Burst Impact (SM8)"],
  ["JP", "GX Ultra Shiny", "Ultra Shiny GX (SM8b)"],
  ["JP", "Tag Bolt", "Tag Bolt (SM9)"],
  ["JP", "Great Detective Pikachu", "Detective Pikachu (SMP2)"],
  ["JP", "Miracle Twin", "Miracle Twins (SM11)"],
  ["JP", "Tag Team GX: Tag All Stars", "Tag Team GX All Stars (SM12a)"],
  ["JP", "Pokémon GO Enhanced Expansion", "Pokemon GO (S10b)"],
];

async function main() {
  let merged = 0;
  for (const [language, shellName, realName] of PAIRS) {
    const lang = language as "EN" | "JP";
    const shells = await prisma.cardSet.findMany({ where: { name: shellName, language: lang }, include: { _count: { select: { cards: true } } } });
    const reals = await prisma.cardSet.findMany({ where: { name: realName, language: lang }, include: { _count: { select: { cards: true } } } });
    if (shells.length === 0) { console.log(`– ${lang} "${shellName}": inget skal (redan sammanslaget?)`); continue; }
    if (shells.length !== 1 || reals.length !== 1) { console.log(`⛔ ${lang} "${shellName}" → "${realName}": ${shells.length} skal / ${reals.length} riktiga — hoppar`); continue; }
    const [shell] = shells, [real] = reals;
    if (shell._count.cards > 0) { console.log(`⛔ "${shellName}" har ${shell._count.cards} kort — inget skal, hoppar`); continue; }
    if (real._count.cards === 0) { console.log(`⛔ "${realName}" har inga kort — hoppar`); continue; }
    if (shell.cmExpansionId != null && real.cmExpansionId != null && shell.cmExpansionId !== real.cmExpansionId) {
      console.log(`⛔ "${shellName}" cm=${shell.cmExpansionId} krockar med "${realName}" cm=${real.cmExpansionId} — hoppar`); continue;
    }
    const shellProducts = await prisma.product.findMany({ where: { setId: shell.id }, select: { title: true, hiddenAt: true } });
    const realSealed = await prisma.product.findMany({ where: { setId: real.id, category: { not: "SINGLE_CARD" } }, select: { title: true, hiddenAt: true } });
    console.log(`✔ ${lang} "${shellName}" (${shellProducts.length} prod, cm=${shell.cmExpansionId ?? "-"}) → "${realName}" (${real._count.cards} kort, cm=${real.cmExpansionId ?? "-"})`);
    for (const p of shellProducts) console.log(`     flyttas: ${p.title}${p.hiddenAt ? " [dold]" : ""}`);
    for (const p of realSealed) console.log(`     finns redan: ${p.title}${p.hiddenAt ? " [dold]" : ""}`);
    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      await tx.product.updateMany({ where: { setId: shell.id }, data: { setId: real.id } });
      // Bevakningar: flytta, men låt en befintlig bevakning av det riktiga setet vinna.
      const watches = await tx.setWatch.findMany({ where: { setId: shell.id } });
      for (const w of watches) {
        const dup = await tx.setWatch.findUnique({ where: { userId_setId: { userId: w.userId, setId: real.id } } });
        if (dup) await tx.setWatch.delete({ where: { id: w.id } });
        else await tx.setWatch.update({ where: { id: w.id }, data: { setId: real.id } });
      }
      const cm = shell.cmExpansionId;
      await tx.cardSet.delete({ where: { id: shell.id } });
      // CM-expansionen följer med så jp-set-label hittar det riktiga setet nästa natt
      // i stället för att skapa skalet igen.
      const fill: Record<string, unknown> = {};
      if (cm != null && real.cmExpansionId == null) fill.cmExpansionId = cm;
      if (!real.logoUrl && shell.logoUrl) fill.logoUrl = shell.logoUrl;
      if (!real.releaseDate && shell.releaseDate) fill.releaseDate = shell.releaseDate;
      if (Object.keys(fill).length) await tx.cardSet.update({ where: { id: real.id }, data: fill });
    });
    merged++;
  }
  // Skal utan kort, utan produkter (inte ens dolda) och utan bevakare: rena rester.
  const orphans = await prisma.cardSet.findMany({
    where: { cards: { none: {} }, products: { none: {} }, watchers: { none: {} } },
    select: { id: true, name: true, language: true },
  });
  for (const o of orphans) console.log(`🗑️  tomt skal utan produkter: ${o.language} "${o.name}"`);
  if (APPLY && orphans.length) await prisma.cardSet.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
  console.log(APPLY ? `\nSammanslagna: ${merged}, raderade tomma: ${orphans.length}` : `\nTORRKÖRNING — kör med --apply`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
