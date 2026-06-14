/** Tester för e-postmallarna i src/emails/templates.ts (svenskt innehåll). */
import { describe, expect, it } from "vitest";
import {
  passwordResetEmail,
  priceAlertEmail,
  restockAlertEmail,
  verifyEmail,
  weeklyReportEmail,
  welcomeEmail,
  type EmailContent,
} from "@/emails/templates";

function expectValidEmail(email: EmailContent) {
  expect(email.subject.length).toBeGreaterThan(0);
  expect(email.html).toContain("<!DOCTYPE html>");
  expect(email.html).toContain('lang="sv"');
  expect(email.html).toContain("PokeFinds");
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
});

describe("weeklyReportEmail", () => {
  it("innehåller statistik", () => {
    const email = weeklyReportEmail("Anna", {
      watchedProducts: 7,
      priceDrops: 3,
      restocks: 2,
    });
    expectValidEmail(email);
    expect(email.subject).toContain("veckorapport");
    expect(email.text).toContain("Bevakade produkter: 7");
    expect(email.text).toContain("Prisfall: 3");
    expect(email.text).toContain("Restocks: 2");
  });

  it("visar största prisfallet när det finns", () => {
    const email = weeklyReportEmail("Anna", {
      watchedProducts: 1,
      priceDrops: 1,
      restocks: 0,
      biggestDrop: { title: "Booster Box", percent: 12.5 },
    });
    expect(email.html).toContain("Booster Box");
    expect(email.text).toContain("Booster Box");
    expect(email.text).toContain("12.5");
  });

  it("utelämnar största prisfallet när det saknas", () => {
    const email = weeklyReportEmail("Anna", { watchedProducts: 0, priceDrops: 0, restocks: 0 });
    expect(email.text).not.toContain("Största prisfallet");
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
