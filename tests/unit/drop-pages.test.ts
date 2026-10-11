/**
 * DOLDA SLÄPP (2026-10-11) — src/lib/drop-pages.ts + embedden.
 * Fixturerna är urklipp ur Spelexpertens riktiga sidor (Sylveon ex Box, sökningen "SYL-01")
 * och Dragon's Lairs förhandsbesked för 30th Celebration-ETB:n.
 */
import { describe, expect, it } from "vitest";
import {
  htmlToText,
  imageKey,
  pickHiddenCandidate,
  readDropInstruction,
  spelexpertenArtnr,
  spelexpertenSearchLinks,
} from "@/lib/drop-pages";
import { buildRestockEmbed, type RestockPost } from "@/lib/discord-restock";

const SPELEXPERTEN_PAGE = `
<div class="PI_Info">Tillf&#228;lligt slut - Oklart datum  Artnr:   POK10463-101-SYL</div>
<h3>S&#229; k&#246;per du artikeln</h3>
<p>F&#246;r att hitta artikeln som g&#229;r att k&#246;pa skriver du artikelnumret nedan i s&#246;krutan p&#229; v&#229;r hemsida:</p>
<div style="border: 1px solid #dce9ec; border-radius: 8px; text-align: center;">SYL-01</div>
<p>Kopiera g&#228;rna artikelnumret och klistra in det i s&#246;krutan. L&#228;s k&#246;pgr&#228;nsen nedan innan du g&#246;r din best&#228;llning.</p>
<h3>Ett k&#246;p per hush&#229;ll</h3>`;

const SPELEXPERTEN_SEARCH = `
<a href="https://www.spelexperten.com/sv/artiklar/pussel/book-nook/index.html">Book nook</a>
<div class="PT_Beskr col"><a href="/sallskapsspel/pokemon/pokemon-tcg-30th-celebration-sylveon-ex-box.html" title="Sylveon ex Box">Sylveon ex Box</a></div>
<div class="PT_Beskr col"><a href="/sallskapsspel/ovrigt/nagot-helt-annat.html" title="Något helt annat">Något helt annat</a></div>`;

const DL_ANNOUNCEMENT =
  "På grund av det stora intresset och användningen av skript och bottar har vi valt att inte länka direkt. " +
  "I morgon ersätter vi texten med en enkel rebus som leder till den riktiga produktsidan. På så sätt vill vi ge er " +
  "som faktiskt läser informationen en bättre chans att beställa före bottarna.";

describe("readDropInstruction", () => {
  it("Spelexperten: koden i instruktionsrutan, inte artikelnumret", () => {
    expect(readDropInstruction(htmlToText(SPELEXPERTEN_PAGE))).toEqual({ kind: "code", code: "SYL-01" });
  });

  it("Dragon's Lair: förhandsbeskedet är inte rebusen", () => {
    expect(readDropInstruction(DL_ANNOUNCEMENT)).toMatchObject({ kind: "riddle", phase: "announced" });
  });

  it("texten byttes efter förhandsbeskedet ⇒ rebusen är LIVE, även utan ordet rebus", () => {
    const announced = readDropInstruction(DL_ANNOUNCEMENT);
    expect(readDropInstruction("Vad blir trettio plus en gul elmus?", announced)).toMatchObject({
      kind: "riddle",
      phase: "live",
    });
  });

  it("en vanlig produktbeskrivning ⇒ ingen instruktion", () => {
    expect(readDropInstruction("Fira 30 år av Pokémon TCG med en jubileumsbox fylld med boosters.")).toBeNull();
  });
});

describe("Spelexperten", () => {
  it("artikelnumret ur produktsidan", () => {
    expect(spelexpertenArtnr(SPELEXPERTEN_PAGE)).toBe("POK10463-101-SYL");
  });

  it("sökträffarna är bara produktkorten, aldrig menylänkarna", () => {
    expect(spelexpertenSearchLinks(SPELEXPERTEN_SEARCH, "https://www.spelexperten.com")).toEqual([
      "https://www.spelexperten.com/sallskapsspel/pokemon/pokemon-tcg-30th-celebration-sylveon-ex-box.html",
      "https://www.spelexperten.com/sallskapsspel/ovrigt/nagot-helt-annat.html",
    ]);
  });
});

describe("pickHiddenCandidate — minst två signaler och exakt en kandidat", () => {
  const orig = {
    url: "https://dragonslair.se/products/etb",
    priceOre: 99500,
    imageKeys: [imageKey("//dragonslair.se/cdn/shop/files/Pokemon30thCelebrationEliteTrainerBox.png?v=1788513534")],
  };
  const hidden = {
    url: "https://dragonslair.se/products/blomkalssoppa",
    priceOre: 99500,
    imageKeys: ["pokemon30thcelebrationelitetrainerbox"],
    text: "Blomkålssoppa Max 1/kund",
  };
  const samePriceOnly = { url: "https://dragonslair.se/products/annat", priceOre: 99500, imageKeys: ["x"], text: "Brädspel" };

  it("pris + bild + köpgräns ⇒ länken", () => {
    expect(pickHiddenCandidate(orig, [hidden, samePriceOnly])?.candidate.url).toBe(hidden.url);
    expect(pickHiddenCandidate(orig, [hidden])?.signals).toEqual(["pris", "bild", "köpgräns"]);
  });

  it("⛔ en signal räcker inte (samma pris av en slump)", () => {
    expect(pickHiddenCandidate(orig, [samePriceOnly])).toBeNull();
  });

  it("⛔ två lika starka kandidater ⇒ ingen gissning", () => {
    expect(pickHiddenCandidate(orig, [hidden, { ...hidden, url: "https://dragonslair.se/products/tva" }])).toBeNull();
  });

  it("originalsidan själv räknas aldrig", () => {
    expect(pickHiddenCandidate(orig, [{ ...hidden, url: orig.url }])).toBeNull();
  });
});

describe("embedden för dolda släpp", () => {
  const base: RestockPost = {
    key: "Spelexperten\thttps://www.spelexperten.com/x/dold.html",
    title: "Pokémon TCG: 30th Celebration Sylveon ex Box",
    storeName: "Spelexperten",
    storeUrl: "https://www.spelexperten.com/x/dold.html",
    priceOre: 47500,
    imageUrl: null,
    setName: "30th Celebration",
    series: null,
    productUrl: null,
  };

  it("dold sida: egen rubrik, texten med koden och originalsidan som eget fält", () => {
    const e = buildRestockEmbed({
      ...base,
      drop: { kind: "hidden", note: "Dold produktsida — hittad via sökkoden SYL-01.", originalUrl: "https://www.spelexperten.com/orig.html" },
    });
    expect(e.title).toBe("Dolt släpp: Pokémon TCG: 30th Celebration Sylveon ex Box");
    expect(e.url).toBe(base.storeUrl);
    expect(e.description).toContain("SYL-01");
    expect(e.fields.find((f) => f.name === "Originalsida")?.value).toContain("orig.html");
  });

  it("rebus: rubriken säger det, inget originalfält (länken ÄR originalet)", () => {
    const e = buildRestockEmbed({
      ...base,
      storeUrl: "https://dragonslair.se/products/etb",
      drop: { kind: "riddle", note: "Rebusen är ute", originalUrl: "https://dragonslair.se/products/etb" },
    });
    expect(e.title.startsWith("Rebus ute nu: ")).toBe(true);
    expect(e.fields.some((f) => f.name === "Originalsida")).toBe(false);
  });
});
