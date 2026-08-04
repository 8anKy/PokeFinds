/**
 * E2E-tester för autentisering.
 *
 * FÖRUTSÄTTNINGAR — seed-datan MÅSTE vara laddad innan dessa körs:
 *   docker compose up -d db redis
 *   npx prisma migrate dev
 *   SEED_DEMO_PASSWORD=<valfritt> npx prisma db seed   ← skapar demo@pokefinds.se m.fl.
 *
 * Lösenordet är INTE hårdkodat någonstans (repot är publikt). Sätt SAMMA
 * SEED_DEMO_PASSWORD här som vid seedningen — annars vet testet inte vad
 * seeden slumpade fram och inloggningstestet hoppas över.
 *
 * Kör: SEED_DEMO_PASSWORD=<samma> npm run test:e2e
 */
import { expect, test } from "@playwright/test";

const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL ?? "demo@pokefinds.se";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD;

test.describe("Registrering", () => {
  // OBS: skapar en ny användare per körning (unik e-post via timestamp).
  // Kräver databas. Rensa testanvändare vid behov via Prisma Studio.
  test("registreringsformuläret validerar och skickar", async ({ page }) => {
    await page.goto("/registrera");
    await expect(page.getByRole("heading", { name: "Skapa konto" })).toBeVisible();

    const uniqueEmail = `e2e-${Date.now()}@example.test`;
    await page.locator("#name").fill("E2E Testare");
    await page.locator("#email").fill(uniqueEmail);
    await page.locator("#password").fill("testlosen123");
    // Bekräfta lösenord-fältet
    await page.locator('input[type="password"]').nth(1).fill("testlosen123");
    await page.getByRole("button", { name: /Skapa konto/ }).click();

    // Nyregistrerade användare loggas in och skickas till onboarding
    await page.waitForURL(/\/(onboarding|logga-in)/, { timeout: 15_000 });
  });

  test("registrering avvisar för kort lösenord", async ({ page }) => {
    await page.goto("/registrera");
    await page.locator("#name").fill("E2E Testare");
    await page.locator("#email").fill("kort@example.test");
    await page.locator("#password").fill("kort");
    await page.locator('input[type="password"]').nth(1).fill("kort");
    await page.getByRole("button", { name: /Skapa konto/ }).click();
    await expect(page.getByText("minst 8 tecken")).toBeVisible();
    expect(page.url()).toContain("/registrera");
  });
});

test.describe("Inloggning", () => {
  // Kräver seedat demokonto (demo@pokefinds.se) OCH att SEED_DEMO_PASSWORD är
  // satt till samma värde som vid seedningen. Utan det kan testet inte veta
  // lösenordet — då HOPPAS det över i stället för att falla på ett gissat värde.
  test("demo-användare loggar in och hamnar på /dashboard", async ({ page }) => {
    test.skip(!DEMO_PASSWORD, "SEED_DEMO_PASSWORD är inte satt — sätt samma värde som vid `prisma db seed`.");

    await page.goto("/logga-in");
    await page.locator("#email").fill(DEMO_EMAIL);
    await page.locator("#password").fill(DEMO_PASSWORD as string);
    await page.getByRole("button", { name: "Logga in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    expect(page.url()).toContain("/dashboard");
  });

  test("fel lösenord visar felmeddelande", async ({ page }) => {
    await page.goto("/logga-in");
    await page.locator("#email").fill(DEMO_EMAIL);
    await page.locator("#password").fill("helt-fel-losenord");
    await page.getByRole("button", { name: "Logga in" }).click();

    await expect(page.getByText("Fel e-post eller lösenord.")).toBeVisible();
    expect(page.url()).toContain("/logga-in");
  });
});
