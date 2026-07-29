/**
 * Tester för skannerns månadskvot (FREE 30 / PREMIUM 100). Prisma mockas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn();
const create = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    scannerJob: {
      count: (...a: unknown[]) => count(...a),
      create: (...a: unknown[]) => create(...a),
    },
  },
}));

import { cardNumberSortKey } from "@/lib/card-number-order";
import { sanitizeName, sanitizeNumber } from "@/services/scanner/claude-vision";
import { getScannerQuota, isIntroScan, parseGuessedNumber, recordScanUsage, runScannerJob } from "@/services/scanner";

beforeEach(() => {
  count.mockReset();
  create.mockReset();
  process.env.OCR_PROVIDER = "mock";
  delete process.env.SCANNER_FREE_MONTHLY_LIMIT;
  delete process.env.SCANNER_PREMIUM_MONTHLY_LIMIT;
  delete process.env.SCANNER_INTRO_SONNET_SCANS;
});

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("getScannerQuota", () => {
  it("FREE = 30/månad default", async () => {
    count.mockResolvedValue(3);
    expect(await getScannerQuota("u1", "FREE")).toEqual({ used: 3, limit: 30, remaining: 27 });
  });

  it("PREMIUM = 100/månad default", async () => {
    count.mockResolvedValue(10);
    expect(await getScannerQuota("u1", "PREMIUM")).toEqual({ used: 10, limit: 100, remaining: 90 });
  });

  it("räknar bara denna månads icke-misslyckade jobb", async () => {
    count.mockResolvedValue(0);
    await getScannerQuota("u1", "FREE");
    const where = count.mock.calls[0][0].where;
    expect(where.status).toEqual({ not: "FAILED" });
    const expected = new Date();
    expected.setUTCDate(1);
    expected.setUTCHours(0, 0, 0, 0);
    expect((where.createdAt.gte as Date).getTime()).toBe(expected.getTime());
  });
});

describe("recordScanUsage", () => {
  it("varje genomförd skanning räknas (COMPLETED)", async () => {
    create.mockResolvedValue({});
    await recordScanUsage("u1");
    expect(create.mock.calls[0][0].data.status).toBe("COMPLETED");
  });
});

describe("isIntroScan", () => {
  it("default AV (kostnadsmål ~$0,002/scan) — även första skanningen = Haiku", async () => {
    count.mockResolvedValue(0);
    expect(await isIntroScan("u1")).toBe(false);
    // Ingen DB-fråga alls när intro är avstängt.
    expect(count).not.toHaveBeenCalled();
  });

  it("påslaget (=1): första skanningen = Sonnet, därefter Haiku", async () => {
    process.env.SCANNER_INTRO_SONNET_SCANS = "1";
    count.mockResolvedValue(0);
    expect(await isIntroScan("u1")).toBe(true);
    count.mockResolvedValue(1);
    expect(await isIntroScan("u1")).toBe(false);
  });

  it("respekterar SCANNER_INTRO_SONNET_SCANS", async () => {
    process.env.SCANNER_INTRO_SONNET_SCANS = "3";
    count.mockResolvedValue(2);
    expect(await isIntroScan("u1")).toBe(true);
    count.mockResolvedValue(3);
    expect(await isIntroScan("u1")).toBe(false);
  });
});

describe("runScannerJob", () => {
  it("blockerar vid månadsgränsen (429) innan jobbet skapas", async () => {
    count.mockResolvedValue(30);
    await expect(runScannerJob("u1", "FREE", PNG)).rejects.toMatchObject({ status: 429 });
  });
});

describe("sanitizeNumber / sanitizeName (modellsvaret är inte alltid ett kortnummer)", () => {
  it("släpper igenom riktiga kortnummer", () => {
    for (const n of ["4/102", "TG07/TG30", "SWSH034", "MEP 074", "130a", "41/159", "SVP 041"]) {
      expect(sanitizeNumber(n)).toBe(n);
    }
  });

  it("kastar verktygsanropets eget serialiseringsformat", () => {
    // MÄTT i produktion, 4 av 12 skanningar. `strict: true` fångar det inte —
    // fältet är typat `string`, så vilken sträng som helst validerar.
    expect(sanitizeNumber('</antml parameters><parameter name="confidence">0.6')).toBe("");
    expect(sanitizeNumber('</antml>\n<parameter name="confidence">0.4')).toBe("");
  });

  it("kastar annat skräp men behåller tomt som tomt", () => {
    expect(sanitizeNumber("")).toBe("");
    expect(sanitizeNumber("   ")).toBe("");
    expect(sanitizeNumber("jag ser inget kortnummer i bilden")).toBe("");
    expect(sanitizeNumber("x".repeat(40))).toBe("");
  });

  it("ett kastat nummer är ÄRLIGARE än ett gissat", () => {
    // Skräpet innehåller siffror, och parseGuessedNumber plockar villigt ut en:
    // ett påhittat nummer kan matcha ett riktigt kort exakt. Tomt gör att
    // matchningen faller tillbaka på namn och bild i stället.
    const junk = '</antml :parameter><parameter name="confidence">0.6';
    expect(parseGuessedNumber(junk)).not.toBeNull(); // skulle ha gissat …
    expect(parseGuessedNumber(sanitizeNumber(junk))).toBeNull(); // … men gör det inte
  });

  it("namnet skyddas likadant mot markup", () => {
    expect(sanitizeName("Charizard ex")).toBe("Charizard ex");
    expect(sanitizeName("<parameter name=\"name\">")).toBe("");
    expect(sanitizeName("Falinks\nrad två")).toBe("");
    expect(sanitizeName("x".repeat(80))).toBe("");
  });
});

describe("parseGuessedNumber (nummer-tolkning för matchning)", () => {
  it("läser full N/T", () => {
    expect(parseGuessedNumber("143/195")).toMatchObject({ num: 143, total: 195, printed: "143" });
  });
  it("läser naket nummer utan total (buggen som gömde rätt Altaria)", () => {
    expect(parseGuessedNumber("143")).toMatchObject({ num: 143, total: null, printed: "143" });
  });
  it("plockar numret ur brus", () => {
    expect(parseGuessedNumber("no. 25")).toMatchObject({ num: 25, total: null });
  });
  it("null när inget nummer finns", () => {
    expect(parseGuessedNumber("Altaria")).toBeNull();
    expect(parseGuessedNumber(null)).toBeNull();
  });

  // BOKSTÄVERNA ÄR EN DEL AV NUMRET. Mot prod-facit med felfri simulerad OCR
  // stod de här formaten för praktiskt taget varenda miss innan fixen — det
  // gamla `parseInt(card.number, 10)` gav NaN och slängde hela nummer-signalen.
  describe("bokstavsnumrerade kort (Trainer Gallery, Shiny Vault, promos)", () => {
    const key = (raw: string) => parseGuessedNumber(raw)?.sortKey;

    it("behåller PREFIXET så nyckeln blir setets, inte huvudnumreringens", () => {
      expect(parseGuessedNumber("TG10/TG30")).toMatchObject({ printed: "TG10", total: 30 });
      expect(key("TG10/TG30")).toBe(cardNumberSortKey("TG10"));
      expect(key("GG08")).toBe(cardNumberSortKey("GG08"));
      expect(key("SV075")).toBe(cardNumberSortKey("SV075"));
      // TG10 och 10 är OLIKA kort — nycklarna får aldrig falla ihop.
      expect(key("TG10")).not.toBe(key("10"));
    });

    it("behåller SUFFIXET — 130a är inte 130", () => {
      expect(parseGuessedNumber("130a")).toMatchObject({ printed: "130a", num: 130 });
      expect(key("130a")).toBe(cardNumberSortKey("130a"));
      expect(key("130a")).not.toBe(key("130"));
    });

    it("tål inledande nollor och mellanslag (SWSH034, MEP 074)", () => {
      expect(key("SWSH034")).toBe(cardNumberSortKey("SWSH034"));
      expect(key("SWSH034")).toBe(key("SWSH34")); // samma kort, olika skrivsätt
      expect(key("MEP 074")).toBe(cardNumberSortKey("MEP 074"));
    });

    it("nyckeln är EXAKT databasens numberSortKey", () => {
      // Speglar Card.numberSortKey (GENERATED). Går de isär slutar uppslaget
      // att träffa och matchningen tappar nummer-signalen tyst.
      for (const n of ["4", "143", "TG10", "GG08", "SWSH034", "SV075", "130a", "MEP 074"]) {
        expect(parseGuessedNumber(n)?.sortKey).toBe(cardNumberSortKey(n));
      }
    });

    it("secret rare: numret läses även när totalen är mindre än numret", () => {
      expect(parseGuessedNumber("199/165")).toMatchObject({ num: 199, total: 165 });
    });
  });

  // 31 kort i katalogen numreras med BARA bokstäver — Unowns alfabet i Unseen
  // Forces ("A"…"Z", "!", "?") och fyra Alph Lithograph ("ONE"…"FOUR").
  describe("bokstavsnumrerade utan siffror (Unown)", () => {
    it("bokstaven ÄR numret", () => {
      expect(parseGuessedNumber("H")).toMatchObject({ printed: "H", num: null, total: null });
      expect(parseGuessedNumber("H")?.sortKey).toBe(cardNumberSortKey("H"));
      expect(parseGuessedNumber("ONE")?.sortKey).toBe(cardNumberSortKey("ONE"));
      expect(parseGuessedNumber("!")?.sortKey).toBe(cardNumberSortKey("!"));
    });

    it("läser INTE totalen som kortnummer när vänstersidan är en bokstav", () => {
      // "O/115" gav förut kort 115 — den nakna regexen hittade inga siffror till
      // vänster och tog de första den såg, dvs totalen.
      const g = parseGuessedNumber("O/115");
      expect(g).toMatchObject({ printed: "O", total: 115 });
      expect(g?.sortKey).toBe(cardNumberSortKey("O"));
      expect(g?.sortKey).not.toBe(cardNumberSortKey("115"));
    });

    it("rör inte de vanliga formaten", () => {
      expect(parseGuessedNumber("TG10/TG30")?.sortKey).toBe(cardNumberSortKey("TG10"));
      expect(parseGuessedNumber("143/195")?.sortKey).toBe(cardNumberSortKey("143"));
    });
  });
});
