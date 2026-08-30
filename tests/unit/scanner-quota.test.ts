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
import { sanitizeName, sanitizeNumber } from "@/services/scanner/vision-contract";
import {
  getScannerQuota,
  isAmbiguous,
  isIntroScan,
  isTied,
  parseGuessedNumber,
  recordScanUsage,
  runScannerJob,
  TIE_MARGIN,
} from "@/services/scanner";

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
    // Två count-anrop: alla jobb, sedan de bildlöst avgjorda som ska DRAS BORT.
    count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    expect(await getScannerQuota("u1", "FREE")).toEqual({ used: 3, limit: 30, remaining: 27 });
  });

  it("PREMIUM = skäligt tak (1000) i stället för en produktgräns", async () => {
    count.mockResolvedValueOnce(10).mockResolvedValueOnce(0);
    expect(await getScannerQuota("u1", "PREMIUM")).toEqual({
      used: 10,
      limit: 1000,
      remaining: 990,
    });
  });

  it("SKANNINGAR UTAN TRÄFF ÄTER INGEN KVOT", async () => {
    // Kvoten mäter VÄRDET kunden fick, inte vår kostnad: en skanning som inte
    // hittade något kort har inte gett något. En träff räknas däremot även när
    // BILDEN avgjorde den utan att kosta ett API-anrop (samma modell som Shiny
    // och Collectr) — annars kostar två identiska skanningar olika mycket kvot
    // beroende på om bildmatchningen råkade vara säker.
    count.mockResolvedValueOnce(10).mockResolvedValueOnce(6);
    const q = await getScannerQuota("u1", "FREE");
    expect(q.used).toBe(4);
    expect(q.remaining).toBe(26);
    // Andra frågan räknar uttryckligen de skanningar som INTE gav en träff.
    expect(count.mock.calls[1][0].where.result).toEqual({
      path: ["matched"],
      equals: false,
    });
  });

  it("räknar bara denna månads icke-misslyckade jobb", async () => {
    count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
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

  // RECALL-BLOCKET ÄR MÄTDATA FÖR ALLA ANVÄNDARE. Vakterna nedan skyddar tre
  // fel som alla är TYSTA: de ger ett tal, bara fel tal.
  describe("recall", () => {
    const resultOf = () => create.mock.calls[0][0].data.result;

    it("skriver INGEN recall-nyckel när argumentet utelämnas", async () => {
      // ⛔ Streckkods- och uppladdningsvägarna kör ALDRIG bildsökningen. En tom
      // `art`-lista där hade räknats som "bilden missade" i recall-rapporten i
      // stället för "bilden tillfrågades aldrig" — dvs mätningen hade sjunkit
      // av rader som inte mäter något. Nyckeln ska då saknas helt.
      create.mockResolvedValue({});
      await recordScanUsage("u1");
      expect(resultOf()).not.toHaveProperty("recall");
    });

    it("enkelskanning taggas INTE med src (default = enkel)", async () => {
      // Alla rader före 2026-08-18 saknar `src`. Skulle enkelskanningen börja
      // sätta ett värde vore de gamla raderna plötsligt en egen, tredje klass.
      create.mockResolvedValue({});
      await recordScanUsage("u1", undefined, true, null, { art: ["a"], shown: ["a"] });
      expect(resultOf().recall).toEqual({ v: 2, art: ["a"], shown: ["a"] });
      expect(resultOf().recall).not.toHaveProperty("src");
    });

    it("ART-AVGJORD MÅSTE bära src: den hinken är också grindad på svaret", async () => {
      // ⛔ Hoppas vision över körs matchCards med TOM OCR, så alla namn-/nummer-
      // poäng blir 0 och den art-säkra kandidaten vinner på ART_TRUST_BONUS —
      // `shown[0] === art[0]` PER KONSTRUKTION, exakt som i bulk. Raderna bar
      // ingen tagg fram till 2026-08-29 och räknades som vanliga mätrader: 142 av
      // 647 bekräftade enkelskanningar, med 100 % topp-1, mot 39,8 % i den hink
      // där vision faktiskt anropades.
      create.mockResolvedValue({});
      await recordScanUsage("u1", undefined, true, { model: null }, {
        art: ["a", "b"],
        shown: ["a"],
        src: "art",
      });
      expect(resultOf().recall.src).toBe("art");
    });

    it("TOM art-lista skriver INGEN recall-nyckel", async () => {
      // Samma regel som när argumentet utelämnas, men den läckte ändå: 4 rader i
      // prod 2026-08-29 bar `art: []`, varav en hade en dom och bokfördes som en
      // MISS. En tom lista betyder "bilden tillfrågades aldrig", inte "bilden
      // missade" — och skillnaden är hela mätningens riktning.
      create.mockResolvedValue({});
      await recordScanUsage("u1", undefined, true, null, { art: [], shown: [] });
      expect(resultOf()).not.toHaveProperty("recall");
    });

    it("fp (fältavtrycket) skrivs för ALLA användare — utan diagnostik, med recall", async () => {
      // Ägarbeslut 2026-08-30: referenser ur riktiga fångster kräver att
      // avtrycken finns för vanliga användare, inte bara i admin-diagnostiken.
      create.mockResolvedValue({ id: "j1" });
      await recordScanUsage(
        "u1",
        undefined,
        true,
        null,
        { art: ["a"], shown: ["a"] },
        { color: ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"], struct: ["s0"] }
      );
      expect(resultOf().fp).toEqual({
        v: 1,
        color: ["c0", "c1", "c2", "c3", "c4", "c5", "c6"],
        struct: ["s0"],
      });
      // Ingen bild i en vanlig rad — remsan är admin-diagnostik.
      expect(resultOf()).not.toHaveProperty("strip");
    });

    it("⛔ fp följer recall-grinden: utan art-lista skrivs inget avtryck", async () => {
      create.mockResolvedValue({ id: "j1" });
      await recordScanUsage("u1", undefined, true, null, { art: [], shown: [] }, { color: ["c0"], struct: [] });
      expect(resultOf()).not.toHaveProperty("fp");
      create.mockClear();
      create.mockResolvedValue({ id: "j2" });
      await recordScanUsage("u1", undefined, true, null, { art: ["a"], shown: ["a"] }, { color: [], struct: [] });
      expect(resultOf()).not.toHaveProperty("fp");
    });

    it("top/margin/sharp skrivs bara när de finns — aldrig som null", async () => {
      // ⛔ `null` i JSON läses som "vi mätte och fick inget". En saknad nyckel är
      // "det här fältet fanns inte när raden skrevs", vilket är sant om varje rad
      // före 2026-08-29. Blandas de ihop går det inte att skilja en gammal rad
      // från en ny där avtrycket saknade tvåa.
      create.mockResolvedValue({});
      await recordScanUsage("u1", undefined, true, null, {
        art: ["a"],
        shown: ["a"],
        top: 0.8,
        margin: null,
        sharp: null,
      });
      const r = resultOf().recall;
      expect(r.top).toBe(0.8);
      expect(r).not.toHaveProperty("margin");
      expect(r).not.toHaveProperty("sharp");
      expect(r).not.toHaveProperty("amb");
    });

    it("bulk MÅSTE bära src: raden är grindad på det den mäter", async () => {
      // identifyCellsArt bokför bara celler där bilden REDAN var säker, så
      // topp-1 är rätt per konstruktion. Utan taggen blandas de in i
      // enkelskanningarnas hink och recall ser ut att stiga mot 100 % utan att
      // något förbättrats. Se scripts/scanner-recall-live.ts.
      create.mockResolvedValue({});
      await recordScanUsage("u1", undefined, true, null, {
        art: ["a", "b"],
        shown: ["a"],
        src: "bulk",
      });
      expect(resultOf().recall).toEqual({ v: 2, art: ["a", "b"], shown: ["a"], src: "bulk" });
    });

    it("recall lever UTANFÖR den admin-grindade diagnostiken", async () => {
      // Diagnostiken skrivs bara för admin. Låg recall inuti den vore mätdatat
      // begränsat till ägarens egna skanningar igen — precis den snedvridning
      // 08-15 avskaffade.
      create.mockResolvedValue({});
      await recordScanUsage("u1", undefined, true, null, { art: ["a"], shown: ["a"] });
      const r = resultOf();
      expect(r).not.toHaveProperty("v");
      expect(r.recall.art).toEqual(["a"]);
    });
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
    // 30 jobb varav 0 bildlöst avgjorda → 30 vision-anrop = FREE-taket.
    count.mockResolvedValueOnce(30).mockResolvedValueOnce(0);
    await expect(runScannerJob("u1", "FREE", PNG)).rejects.toMatchObject({ status: 429 });
  });
});

describe("isAmbiguous (utan avstånd till nästa KORT finns ingen träff att påstå)", () => {
  const c = (
    cardId: string,
    score: number,
    variantLabel: string | null = null,
    productId: string | null = null
  ) => ({
    cardId,
    name: "Gyarados",
    setName: "151",
    number: "130",
    rarity: "Rare",
    imageUrl: null,
    slug: null,
    productId,
    variantLabel,
    score,
    estimatedValue: null,
  });

  it("flaggar oavgjort mellan olika kort", () => {
    // MÄTT: användaren skannade en Gyarados, numret blev skräp och bilden var
    // oanvändbar (klassiskt ramat kort) → alla nio Gyarados fick 1,000 och koden
    // valde en på tiebreak. Tre skanningar, tre självsäkra FEL svar.
    expect(isAmbiguous([c("a", 1.0), c("b", 1.0), c("d", 1.0)])).toBe(true);
    expect(isAmbiguous([c("a", 1.0), c("b", 0.98)])).toBe(true);
  });

  it("flaggar INTE en träff med tydligt övertag", () => {
    // Ett äkta övertag är stort: nummerträff +0,4–0,5, säker bildträff +1,15.
    expect(isAmbiguous([c("a", 1.5), c("b", 1.0)])).toBe(false);
    expect(isAmbiguous([c("a", 2.4), c("b", 1.0)])).toBe(false);
  });

  it("räknar INTE andra TRYCKNINGAR av samma kort som konkurrenter", () => {
    // Base Unlimited/Shadowless/1st Edition ligger med flit 0,001 från varandra.
    // Det är ett val av tryckning, inte tvivel om vilket kort det är — hade de
    // räknats som oavgjort vore VARJE Base-skanning "ingen träff".
    const printings = [
      c("base-charizard", 1.5, "Unlimited", "p1"),
      c("base-charizard", 1.499, "1st Edition", "p2"),
      c("base-charizard", 1.499, "Shadowless", "p3"),
    ];
    expect(isAmbiguous(printings)).toBe(false);
    // …men ett ANNAT kort tätt efter är fortfarande oavgjort.
    expect(isAmbiguous([...printings, c("other", 1.48)])).toBe(true);
  });

  // ⛔ ATT MÄRKA OCH ATT FRÅGA ÄR OLIKA BESLUT. `isAmbiguous` (0,05) styr det
  // gula "?" — gratis för användaren, alltså generös. `isTied` (0,01) styr
  // VALSTEGET, som kostar ett tryck och blockerar masstillägget. Samma tröskel
  // för båda provades 2026-07-30 (commit e9b3e11) och gjorde att "de flesta kort
  // blev 'ingen träff'" (8c7529c vände det). Testerna nedan vaktar att de inte
  // glider ihop igen.
  it("isTied är STRIKT SMALARE än isAmbiguous", () => {
    expect(TIE_MARGIN).toBeLessThan(0.05);
    // Bandet mellan trösklarna: MÄRKS som gissning, men frågas INTE om.
    const nearMiss = [c("a", 1.0), c("b", 0.97)];
    expect(isAmbiguous(nearMiss)).toBe(true);
    expect(isTied(nearMiss)).toBe(false);
  });

  it("isTied fyrar på det UPPMÄTTA fallet: nio Gyarados på exakt 1,000", () => {
    // Namnet lästes rätt, numret var oläsligt, bilden oanvändbar. Där är ett
    // svar ren tärningskastning och en fråga det enda ärliga.
    expect(isTied([c("a", 1.0), c("b", 1.0), c("d", 1.0)])).toBe(true);
  });

  it("isTied räknar INTE tryckningar av samma kort som oavgjort", () => {
    // Samma regel som isAmbiguous — annars hade VARJE Base-skanning blivit en
    // fråga, och frågan hade varit fel: tryckningen väljs i variantväljaren.
    expect(
      isTied([
        c("base-charizard", 1.5, "Unlimited", "p1"),
        c("base-charizard", 1.5, "1st Edition", "p2"),
      ])
    ).toBe(false);
  });

  it("tål tom lista och en enda kandidat", () => {
    expect(isAmbiguous([])).toBe(false);
    expect(isAmbiguous([c("a", 1.0)])).toBe(false);
    expect(isTied([])).toBe(false);
    expect(isTied([c("a", 1.0)])).toBe(false);
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
