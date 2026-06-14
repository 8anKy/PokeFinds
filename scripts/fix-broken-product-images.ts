/**
 * Ersätter pokemoncenter.com-bildlänkar (Akamai blockerar hotlinking →
 * text/html-svar, bilden renderas aldrig) med verifierade produktbilder
 * från butiker vi redan länkar till (og:image / Webhallen produkt-API).
 * Alla URL:er verifierade 2026-06-12 (HTTP 200, riktig bilddata).
 * Kör: npx tsx --env-file=.env scripts/fix-broken-product-images.ts
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const REPLACEMENTS: { titleContains: string; imageUrl: string }[] = [
  { titleContains: "Trainers Toolkit 2025", imageUrl: "https://www.alphaspel.se/media/products/69b39fb5-8a3b-4c06-8ade-6a044d7a8aea" },
  { titleContains: "Battle Academy Pikachu vs Eevee vs Cinderace", imageUrl: "https://www.webhallen.com/images/product/345269?trim&w=700" },
  { titleContains: "Ascended Heroes First Partners Deluxe Pin Collection", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK10301-107.jpg" },
  { titleContains: "Mega Charizard X ex Ultra Premium Collection", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK10065-101.jpg" },
  { titleContains: "Ascended Heroes Booster Bundle", imageUrl: "https://www.spelexperten.com/bilder/artiklar/POK10311-101.jpg" },
];

async function main() {
  for (const r of REPLACEMENTS) {
    const res = await prisma.product.updateMany({
      where: { title: { contains: r.titleContains }, imageUrl: { contains: "pokemoncenter.com" } },
      data: { imageUrl: r.imageUrl },
    });
    console.log(`${r.titleContains}: ${res.count} uppdaterad(e)`);
  }
  const left = await prisma.product.count({ where: { imageUrl: { contains: "pokemoncenter.com" } } });
  console.log(`Kvar med pokemoncenter-bild: ${left}`);
}
main().finally(() => prisma.$disconnect());
