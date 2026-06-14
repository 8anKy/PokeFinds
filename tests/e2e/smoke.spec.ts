/**
 * Röktester (smoke tests) för PokeFinds.
 *
 * FÖRUTSÄTTNINGAR:
 *  - Databasen körs och är migrerad + seedad:
 *      docker compose up -d db redis
 *      npx prisma migrate dev && npx prisma db seed
 *  - Dev-servern startas automatiskt av Playwright (webServer i
 *    playwright.config.ts), eller kör `npm run dev` själv i förväg.
 *
 * Kör: npm run test:e2e
 */
import { expect, test } from "@playwright/test";

test.describe("Röktester — publika sidor", () => {
  test("startsidan laddar med PokeFinds i titeln", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/PokeFinds/);
    await expect(page.locator("body")).toBeVisible();
  });

  test("navigering till /produkter renderar produktkatalogen", async ({ page }) => {
    await page.goto("/produkter");
    await expect(page).toHaveTitle(/PokeFinds/);
    // Sidan ska rendera innehåll (inte 404/500)
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("/logga-in visar inloggningsformulär", async ({ page }) => {
    await page.goto("/logga-in");
    await expect(page.getByRole("heading", { name: "Logga in" })).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Logga in" })).toBeVisible();
  });

  test("/priser renderar prissidan", async ({ page }) => {
    await page.goto("/priser");
    await expect(page).toHaveTitle(/PokeFinds/);
    await expect(page.locator("h1").first()).toBeVisible();
  });
});
