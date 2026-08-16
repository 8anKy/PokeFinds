/**
 * VECKOBREVET — vakter för de tre saker som går sönder tyst.
 *
 * 1. Avregistreringslänken. Ett massutskick med tokens som inte verifierar lämnar
 *    spamknappen som mottagarens enda utväg.
 * 2. Notisdefaulterna. `NOTIFICATION_DEFAULTS` och `@default` på
 *    `User.notificationSettings` MÅSTE vara samma objekt — glider de isär beter sig
 *    gamla och nya konton olika, och det syns först när någon undrar varför hen
 *    inte får brevet.
 * 3. Tomma avsnitt. "0 prisfall" och "+0,0 %" är fabricerat innehåll; avsnitt utan
 *    data ska UTELÄMNAS, inte nollas.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NOTIFICATION_DEFAULTS,
  parseNotificationSettings,
} from "@/lib/notification-settings";
import { weeklyDigestEmail } from "@/emails/templates";

describe("avregistreringstoken", () => {
  const OLD = process.env.UNSUBSCRIBE_SECRET;
  beforeEach(() => {
    process.env.UNSUBSCRIBE_SECRET = "test-hemlighet";
  });
  afterEach(() => {
    if (OLD === undefined) delete process.env.UNSUBSCRIBE_SECRET;
    else process.env.UNSUBSCRIBE_SECRET = OLD;
  });

  // Modulen läser hemligheten vid ANROP, inte vid import — därav dynamiska imports.
  async function lib() {
    return import("@/lib/unsubscribe-token");
  }

  it("verifierar sin egen token och bär tillbaka userId + typ", async () => {
    const { createUnsubscribeToken, verifyUnsubscribeToken } = await lib();
    const token = createUnsubscribeToken("clx123abc", "weekly");
    expect(verifyUnsubscribeToken(token)).toEqual({ userId: "clx123abc", type: "weekly" });
  });

  it("token bär ALDRIG e-postadressen (kartläggningsregeln)", async () => {
    const { createUnsubscribeToken } = await lib();
    expect(createUnsubscribeToken("clx123abc", "weekly")).not.toContain("@");
  });

  it("avvisar manipulerat userId, manipulerad signatur och fel hemlighet", async () => {
    const { createUnsubscribeToken, verifyUnsubscribeToken } = await lib();
    const token = createUnsubscribeToken("clx123abc", "weekly");
    const [type, , sig] = token.split(".");

    expect(verifyUnsubscribeToken(`${type}.NÅGON_ANNAN.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${type}.clx123abc.${sig}x`)).toBeNull();
    expect(verifyUnsubscribeToken("skräp")).toBeNull();
    expect(verifyUnsubscribeToken(null)).toBeNull();

    process.env.UNSUBSCRIBE_SECRET = "en-annan-hemlighet";
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("vägrar signera utan hemlighet — hellre inget utskick än döda länkar", async () => {
    delete process.env.UNSUBSCRIBE_SECRET;
    const old = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    const { requireUnsubscribeSecret } = await lib();
    expect(() => requireUnsubscribeSecret()).toThrow();
    if (old !== undefined) process.env.NEXTAUTH_SECRET = old;
  });
});

describe("notisdefaulterna speglar schema.prisma", () => {
  it("@default på User.notificationSettings = NOTIFICATION_DEFAULTS", () => {
    const schema = readFileSync(resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
    const m = schema.match(/notificationSettings\s+Json\s+@default\("(.+?)"\)/);
    expect(m, "hittade ingen @default på notificationSettings").toBeTruthy();
    const fromSchema = JSON.parse(m![1].replace(/\\"/g, '"'));
    expect(fromSchema).toEqual(NOTIFICATION_DEFAULTS);
  });

  it("veckobrevet är PÅ för ett konto som aldrig rört inställningarna", () => {
    expect(parseNotificationSettings({}).weekly).toBe(true);
    expect(parseNotificationSettings({ weekly: false }).weekly).toBe(false);
    // Trasig rad får aldrig kasta — larmutskicket hänger på samma läsare.
    expect(parseNotificationSettings("nonsens").weekly).toBe(true);
  });
});

describe("weeklyDigestEmail", () => {
  const base = {
    name: "Anna",
    unsubscribeUrl: "https://foilio.se/api/unsubscribe?token=abc",
    drops: [],
    restocks: [],
    pulse: {
      underMarketCount: 0,
      minDiscountPercent: 30,
      examples: [],
      restockCount: 0,
      newSetCount: 0,
    },
  };

  it("utelämnar avsnitt utan data — inga nollor, inga '+0,0 %'", () => {
    const mail = weeklyDigestEmail(base);
    expect(mail.html).not.toContain("Din samling");
    expect(mail.html).not.toContain("Prisfall");
    expect(mail.text).not.toContain("0,0 %");
    expect(mail.text).not.toContain("0 varor");
  });

  it("bär avanmälan i BÅDE html och text — text-only-läsare måste också kunna säga nej", () => {
    const mail = weeklyDigestEmail(base);
    expect(mail.html).toContain(base.unsubscribeUrl);
    expect(mail.text).toContain(base.unsubscribeUrl);
    // Textversionen får inte innehålla HTML (samma invariant som övriga mallar).
    expect(mail.text).not.toMatch(/<[a-z][\s\S]*>/i);
  });

  it("visar samlingens värde utan förändringsrad när sjudagarskurvan saknas", () => {
    const mail = weeklyDigestEmail({
      ...base,
      collection: { totalValueOre: 100000, changeOre: null, changePercent: null, movers: [] },
    });
    // sv-SE använder hårt mellanslag som tusentalsavgränsare — matcha båda.
    expect(mail.text).toMatch(/1\s?000,00\s?kr/u);
    expect(mail.text).not.toContain("Senaste sju dagarna");
  });

  it("ämnesraden bär antalet under marknadspris när det finns ett", () => {
    const mail = weeklyDigestEmail({
      ...base,
      pulse: { ...base.pulse, underMarketCount: 93 },
    });
    expect(mail.subject).toContain("93");
    // Tröskeln i copyn kommer från samma tal som bandet räknades med.
    expect(mail.html).toContain("30 %");
  });
});
