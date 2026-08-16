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
 * 4. Movers-dedupen. Samlingen lagrar LOTS, så samma vara köpt två gånger ger två
 *    movers-rader — och brevet listade 2026-08-16 samma produkt två gånger av tre.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NOTIFICATION_DEFAULTS,
  parseNotificationSettings,
} from "@/lib/notification-settings";
import { weeklyDigestEmail } from "@/emails/templates";

// Jobbet importerar prisma-klienten; dedupen är ren och rör aldrig databasen.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { pickMovers, type CollectionRef } from "@/jobs/weekly-digest";
import type { CollectionMover } from "@/services/collection";

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

describe("movers: en rad per VARA, aldrig en per lot", () => {
  const mover = (over: Partial<CollectionMover> & { id: string }): CollectionMover => ({
    name: "Prismatic Evolutions Super-Premium Collection",
    imageUrl: null,
    setName: null,
    value: 258_511,
    percent: 7.3,
    ...over,
  });
  // Två LOTS av samma produkt (två köp till olika pris) + en annan vara.
  const refs = new Map<string, CollectionRef>([
    ["lot-1", { key: "product:prismatic-spc", url: "https://foilio.se/produkter/a" }],
    ["lot-2", { key: "product:prismatic-spc", url: "https://foilio.se/produkter/a" }],
    ["lot-3", { key: "card:umbreon-vmax", url: "https://foilio.se/produkter/b" }],
  ]);

  it("dedupar på varans identitet — det skarpa brevet listade samma box två gånger", () => {
    const out = pickMovers(
      [mover({ id: "lot-1" }), mover({ id: "lot-2", percent: 6.1 }), mover({ id: "lot-3", name: "Umbreon VMAX", percent: 4 })],
      refs
    );
    expect(out.map((m) => m.name)).toEqual([
      "Prismatic Evolutions Super-Premium Collection",
      "Umbreon VMAX",
    ]);
  });

  it("dedupar FÖRE kapningen — tre rader betyder tre olika varor", () => {
    const many = new Map<string, CollectionRef>([
      ...refs,
      ["lot-4", { key: "card:charizard", url: null }],
      ["lot-5", { key: "card:pikachu", url: null }],
    ]);
    const out = pickMovers(
      [
        mover({ id: "lot-1" }),
        mover({ id: "lot-2", percent: 6.9 }),
        mover({ id: "lot-3", name: "Umbreon VMAX", percent: 5 }),
        mover({ id: "lot-4", name: "Charizard ex", percent: 4 }),
        mover({ id: "lot-5", name: "Pikachu", percent: 3 }),
      ],
      many,
      3
    );
    expect(out).toHaveLength(3);
    expect(new Set(out.map((m) => m.name)).size).toBe(3);
  });

  it("behåller ordningen (störst uppgång först) och första lotten av varan", () => {
    const out = pickMovers([mover({ id: "lot-1", percent: 9.5 }), mover({ id: "lot-2", percent: 2.1 })], refs);
    expect(out).toHaveLength(1);
    expect(out[0].percent).toBe(9.5);
    expect(out[0].url).toBe("https://foilio.se/produkter/a");
  });

  it("faller tillbaka på namn+set när posten saknas i uppslaget — hellre än en dubblett", () => {
    const out = pickMovers(
      [mover({ id: "borta-1" }), mover({ id: "borta-2", percent: 1 })],
      new Map<string, CollectionRef>()
    );
    expect(out).toHaveLength(1);
    expect(out[0].url).toBeNull();
  });

  it("relativa bild-URL:er blir absoluta, skräp blir null — mejlklienten har ingen bas-URL", () => {
    const out = pickMovers(
      [
        mover({ id: "lot-1", imageUrl: "/uploads/min-bild.jpg" }),
        mover({ id: "lot-3", imageUrl: "data:image/png;base64,AAAA" }),
      ],
      refs
    );
    expect(out[0].imageUrl?.startsWith("https://")).toBe(true);
    expect(out[1].imageUrl).toBeNull();
  });
});

describe("weeklyDigestEmail", () => {
  const base = {
    name: "Anna",
    unsubscribeUrl: "https://foilio.se/api/unsubscribe?token=abc",
    // Bas-URL:en injiceras av jobbet — mallen läser aldrig miljön själv.
    appUrl: "https://foilio.se",
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
