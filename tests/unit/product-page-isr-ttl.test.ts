/**
 * Produktsidan är ett DB-fritt skal med 30-dygns ISR (2026-08-29). Två saker
 * kan tyst göra den 1h-cachad igen, och båda syns bara i källtexten:
 *   1. en import av en 1h-cachad läsning (`getProductBySlug`/`loadProductDetail`)
 *      — Next tar MIN av segmentets revalidate och alla cachade läsningar,
 *   2. att `revalidate` sänks eller skalets cache får en annan TTL än sidan.
 * Och en tredje sak gör hela vinsten till noll: att /api/revalidate börjar
 * kasta produktsidorna igen.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PRODUCT_PAGE_HTML_REVALIDATE_SECONDS, PRODUCT_PAGE_REVALIDATE_SECONDS } from "@/services/products";

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../..", p), "utf8");

describe("produktsidans ISR-TTL", () => {
  const page = read("src/app/[locale]/(marketing)/produkter/[slug]/page.tsx");
  const services = read("src/services/products.ts");
  const revalidateRoute = read("src/app/api/revalidate/route.ts");

  // 2026-10-07: HTML:en byggs ur katalogsnapshoten (en FIL) ⇒ ett dygns TTL kostar ingen
  // Neon-tid. Skal-cachen (reserven) behåller sina 30 dygn.
  it("HTML-TTL är ett dygn, skal-cachen (reserven) minst 30 dygn", () => {
    expect(PRODUCT_PAGE_HTML_REVALIDATE_SECONDS).toBe(24 * 3600);
    expect(PRODUCT_PAGE_REVALIDATE_SECONDS).toBeGreaterThanOrEqual(30 * 24 * 3600);
    expect(page).toMatch(/export const revalidate = PRODUCT_PAGE_HTML_REVALIDATE_SECONDS;/);
    expect(services).toMatch(
      /cachedRead\(loadProductShellRaw, "loadProductShell", PRODUCT_PAGE_REVALIDATE_SECONDS, \[STATIC_CACHE_TAG\]\)/
    );
  });

  it("sidan läser snapshoten först, och snapshot-läsaren rör aldrig databasen", () => {
    expect(page).toContain("readSnapshotEntry(slug)");
    const reader = read("src/lib/catalog-snapshot.ts");
    expect(reader).not.toMatch(/from "@\/lib\/db"/);
    expect(reader).not.toMatch(/prisma\.|@prisma\/client/);
  });

  it("sidan importerar ingen 1h-cachad läsning och formaterar inga priser själv", () => {
    const imports = page.match(/import \{([^}]*)\} from "@\/services\/products"/)?.[1] ?? "";
    expect(imports).toContain("loadProductShell");
    for (const forbidden of ["getProductBySlug", "loadProductDetail", "getPriceHistory", "getSimilarProducts"]) {
      expect(imports, forbidden).not.toContain(forbidden);
    }
    expect(page).not.toMatch(/from "@\/lib\/format"/);
    for (const forbidden of ["formatPrice(", "serializedOffers"]) {
      expect(page, forbidden).not.toContain(forbidden);
    }
  });

  it("/api/revalidate kastar inte produktsidorna längre", () => {
    expect(revalidateRoute).not.toMatch(/revalidatePath\(\s*"\/\[locale\]\/produkter\/\[slug\]"/);
  });

  it("skalets Prisma-fråga väljer inga prisfält (offers/snapshots)", () => {
    const start = services.indexOf("async function loadProductShellRaw");
    const end = services.indexOf("const cachedProductShell");
    const body = services.slice(start, end);
    expect(start).toBeGreaterThan(0);
    for (const forbidden of ["offers", "priceSnapshots", "watchlistItems"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });
});
