/** Tester för e-postmallarna i src/emails/templates.ts (svenskt innehåll). */
import { describe, expect, it } from "vitest";
import {
  newListingEmail,
  passwordResetEmail,
  priceAlertEmail,
  restockAlertEmail,
  verifyEmail,
  welcomeEmail,
  type EmailContent,
} from "@/emails/templates";

function expectValidEmail(email: EmailContent) {
  expect(email.subject.length).toBeGreaterThan(0);
  expect(email.html).toContain("<!DOCTYPE html>");
  expect(email.html).toContain('lang="sv"');
  expect(email.html).toContain("Foilio");
  expect(email.text.length).toBeGreaterThan(0);
  // Textversionen ska inte innehålla HTML-taggar
  expect(email.text).not.toMatch(/<[a-z][\s\S]*>/i);
}

describe("welcomeEmail", () => {
  it("returnerar giltigt mejl med namn och svensk hälsning", () => {
    const email = welcomeEmail("Anna");
    expectValidEmail(email);
    expect(email.subject).toContain("Välkommen");
    expect(email.html).toContain("Anna");
    expect(email.text).toContain("Anna");
  });
});

describe("verifyEmail", () => {
  it("innehåller verifieringslänken i både html och text", () => {
    const url = "https://example.test/verifiera?token=abc123";
    const email = verifyEmail("Anna", url);
    expectValidEmail(email);
    expect(email.subject).toContain("Bekräfta");
    expect(email.html).toContain(url);
    expect(email.text).toContain(url);
  });
});

describe("priceAlertEmail", () => {
  it("innehåller produkt, formaterat SEK-pris och länk", () => {
    const email = priceAlertEmail("Anna", "Booster Box", 129900, "https://example.test/p");
    expectValidEmail(email);
    expect(email.subject).toContain("Prisfall");
    expect(email.subject).toContain("Booster Box");
    // 1299,00 kr (sv-SE, hårt mellanslag möjligt)
    expect(email.subject).toMatch(/1\s?299,00\s?kr/u);
    expect(email.html).toContain("https://example.test/p");
    expect(email.text).toContain("https://example.test/p");
  });
});

describe("restockAlertEmail", () => {
  it("innehåller produkt, butik och svensk copy", () => {
    const email = restockAlertEmail("Anna", "Booster Box", "Demobutiken", "https://example.test/p");
    expectValidEmail(email);
    expect(email.subject).toContain("Åter i lager");
    expect(email.html).toContain("Demobutiken");
    expect(email.text).toContain("Demobutiken");
    expect(email.text).toContain("Booster Box");
  });

  it("'Köp nu'-knappen länkar exakt till angiven butiks-URL", () => {
    // buildAlertEmail skickar butikens offer.url hit → knappen MÅSTE peka dit
    // (ej vår produktsida). Restock-mejlet ska öppna butiken med rätt produkt.
    const storeUrl = "https://shinycards.se/produkt/sword-shield-booster";
    const email = restockAlertEmail("Milos", "Sword & Shield Booster Pack", "Shinycards", storeUrl);
    expect(email.html).toContain(`href="${storeUrl}"`);
    expect(email.text).toContain(storeUrl);
  });
});

describe("newListingEmail", () => {
  it("länkar direkt till butiken och visar pris när det finns", () => {
    const storeUrl = "https://webhallen.com/se/product/poke-ball-tin-2025-v2";
    const email = newListingEmail("Milos", "Poké Ball Tin 2025 v2", "Webhallen", storeUrl, 24900);
    expectValidEmail(email);
    expect(email.subject).toContain("Ny produkt i lager");
    expect(email.subject).toContain("Poké Ball Tin 2025 v2");
    expect(email.html).toContain(`href="${storeUrl}"`);
    expect(email.html).toContain("Webhallen");
    expect(email.text).toContain(storeUrl);
    expect(email.html).toMatch(/249,00\s?kr/u);
  });

  it("fungerar utan pris (feeden saknade pris)", () => {
    const email = newListingEmail("Milos", "Okänd Booster", "Samlarhobby", "https://samlarhobby.se/p");
    expectValidEmail(email);
    expect(email.text).not.toMatch(/kr/); // inget prisrad när price saknas
  });
});

describe("passwordResetEmail", () => {
  it("innehåller återställningslänk och giltighetstid", () => {
    const url = "https://example.test/aterstall?token=xyz";
    const email = passwordResetEmail("Anna", url);
    expectValidEmail(email);
    expect(email.subject).toContain("Återställ");
    expect(email.html).toContain(url);
    expect(email.text).toContain(url);
    expect(email.text).toContain("1 timme");
  });
});
