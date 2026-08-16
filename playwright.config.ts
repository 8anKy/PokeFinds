import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3000",
    /**
     * ⛔ LOCALE MÅSTE PINNAS TILL SVENSKA — annars är röktesterna ett lotteri.
     *
     * next-intl väljer språk ur `Accept-Language` (`defaultLocale: "sv"` gäller bara
     * när headern inte pekar någon annanstans). Playwrights chromium skickar `en-US`,
     * så appen svarade ENGELSKA och `/logga-in`-testet letade efter rubriken
     * "Logga in" på en sida som renderat "Log in". Det upptäcktes först 2026-08-16,
     * när e2e kördes i CI för allra första gången — specarna fanns sedan länge men
     * kördes av ingenting, så ingen såg att de var språkberoende.
     *
     * Svenska är dessutom RÄTT yta att röktesta: all copy skrivs på svenska först och
     * `messages/en.json` följer efter. `locale` sätter Accept-Language åt oss.
     */
    locale: "sv-SE",
    timezoneId: "Europe/Stockholm",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
