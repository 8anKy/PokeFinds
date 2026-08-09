/**
 * KATALOGNAMNET = CARDMARKETS NAMN (ägarbeslut 2026-08-09).
 *
 * Auto-importerade stubbar bär butikens fras ("FÖRBOKNING! Pokemon 30th
 * Anniversary Celebration M6 MEGA Booster Box (Japansk)") tills de får sin
 * CM-identitet. När identiteten avgörs (fuzzy-matchen i cardmarket-refresh,
 * JP-auto-mappningen) adopteras CM:s katalognamn i samma andetag — samma
 * princip som set-etiketten. Befintlig data städas av
 * `scripts/adopt-cm-names.ts` (torrkörning default).
 *
 * ⛔ KOLLISIONSVAKT: bär en ANNAN produkt (samma språk) redan det normaliserade
 * namnet skrivs INGENTING. Boxart-varianter ([GVSE]/[LUJF]) och andra medvetet
 * åtskilda produkter får aldrig kollapsa till samma titel — två identiska
 * titlar i katalogen är värre än en butiksfras.
 *
 * Sluggen rörs ALDRIG: URL:er är publicerade (Google-index, larm-mejl,
 * bevakningslänkar) och produktsidan slår upp på slug.
 */
import { prisma } from "../lib/db";
import { normalizeTitle } from "../lib/utils";

export async function adoptCmName(productId: string, cmName: string): Promise<boolean> {
  const title = cmName.trim();
  if (!title) return false;
  const normalized = normalizeTitle(title);
  if (!normalized) return false;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { title: true, normalizedTitle: true, language: true },
  });
  if (!product || product.normalizedTitle === normalized) return false;

  const collision = await prisma.product.findFirst({
    where: { normalizedTitle: normalized, language: product.language, id: { not: productId } },
    select: { id: true },
  });
  if (collision) {
    console.log(`[cm-name] Kollision — behåller "${product.title}" (CM-namnet "${title}" ägs redan av ${collision.id})`);
    return false;
  }

  await prisma.product.update({
    where: { id: productId },
    data: { title, normalizedTitle: normalized },
  });
  console.log(`[cm-name] "${product.title}" → "${title}"`);
  return true;
}
