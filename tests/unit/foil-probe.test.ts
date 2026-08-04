/**
 * FOLIESONDEN mäter samma rutnät som konstavtrycket — annars är varje
 * jämförelse mellan dem nonsens, TYST.
 *
 * Sonden räknas av klienten (canvas, 4 kanaler) och jämförs på servern mot ett
 * index byggt med sharp (3 kanaler). Samma fälla som `Card.numberSortKey` mot
 * `cardNumberSortKey()` och som färg-/strukturavtrycken redan har ett test för:
 * två implementationer av samma nyckel går isär utan att något kastar.
 *
 * Testerna här vaktar tre saker:
 *   1. cellindelningen är IDENTISK med fingerprintFromRgb (3- och 4-kanalsvägen
 *      ger samma sond, och en cell i sonden täcker samma pixlar som i avtrycket)
 *   2. region-masken är den dokumenterade (24 konstceller, 64 kroppsceller)
 *   3. måtten pekar åt rätt håll på syntetiska fall — och ger null, aldrig ett
 *      påhittat tal, när indata saknas
 */
import { describe, expect, it } from "vitest";
import { GRID_H, GRID_W, fingerprintFromRgb } from "@/lib/art-fingerprint";
import {
  ART_CELLS,
  BODY_CELLS,
  PROBE_BYTES,
  PROBE_CELLS,
  PROBE_CHROMA,
  PROBE_CLIP,
  PROBE_LUM,
  PROBE_LUMSTD,
  cellRegion,
  deviationByRegion,
  foilMetrics,
  foilProbeFromRgb,
  specularByRegion,
  temporalByRegion,
} from "@/lib/foil-probe";

/** Bild där varje cell har sin egen jämna färg — cell i får värdet i. */
function cellPattern(w: number, h: number, channels: 3 | 4, boost?: (cell: number) => number) {
  const px = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(GRID_H - 1, Math.floor((y * GRID_H) / h));
    for (let x = 0; x < w; x++) {
      const gx = Math.min(GRID_W - 1, Math.floor((x * GRID_W) / w));
      const cell = gy * GRID_W + gx;
      const v = Math.min(255, cell * 2 + (boost?.(cell) ?? 0));
      const p = (y * w + x) * channels;
      px[p] = v;
      px[p + 1] = v;
      px[p + 2] = v;
      if (channels === 4) px[p + 3] = 255;
    }
  }
  return px;
}

describe("foilProbeFromRgb", () => {
  it("ger samma sond från 3 och 4 kanaler", () => {
    const a = foilProbeFromRgb(cellPattern(96, 132, 3), 96, 132, 3);
    const b = foilProbeFromRgb(cellPattern(96, 132, 4), 96, 132, 4);
    expect(a).not.toBeNull();
    expect(Array.from(a!)).toEqual(Array.from(b!));
  });

  it("har sonden och avtrycket samma cellindelning", () => {
    // Samma bild genom båda vägarna: cellen med högst luminans i sonden måste
    // vara cellen med högst standardiserat värde i avtrycket.
    const px = cellPattern(96, 132, 4);
    const probe = foilProbeFromRgb(px, 96, 132, 4)!;
    const fp = fingerprintFromRgb(px, 96, 132, 4)!;
    const argmax = (get: (i: number) => number) => {
      let best = 0;
      for (let i = 1; i < PROBE_CELLS; i++) if (get(i) > get(best)) best = i;
      return best;
    };
    expect(argmax((i) => probe[PROBE_LUM * PROBE_CELLS + i])).toBe(argmax((i) => fp[i]));
  });

  it("mäter luminans, textur, klippning och kroma per cell", () => {
    const w = 80;
    const h = 110;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      // Vänstra halvan vit (utbränd), högra halvan mättat röd (hög kroma, ej klipp).
      const x = i % w;
      const white = x < w / 2;
      px[i * 4] = white ? 255 : 220;
      px[i * 4 + 1] = white ? 255 : 20;
      px[i * 4 + 2] = white ? 255 : 20;
      px[i * 4 + 3] = 255;
    }
    const probe = foilProbeFromRgb(px, w, h, 4)!;
    // Cell (0,0) = vit → full klippning, ingen kroma.
    expect(probe[PROBE_CLIP * PROBE_CELLS + 0]).toBe(255);
    expect(probe[PROBE_CHROMA * PROBE_CELLS + 0]).toBe(0);
    // Cell (7,0) = röd → ingen klippning trots hög R, hög kroma.
    expect(probe[PROBE_CLIP * PROBE_CELLS + 7]).toBe(0);
    expect(probe[PROBE_CHROMA * PROBE_CELLS + 7]).toBe(200);
    // Jämn färg inom cellen ⇒ ingen textur.
    expect(probe[PROBE_LUMSTD * PROBE_CELLS + 0]).toBe(0);
  });

  it("avvisar ytor som är mindre än rutnätet", () => {
    expect(foilProbeFromRgb(new Uint8Array(3 * 3 * 4), 3, 3, 4)).toBeNull();
    // För kort buffert = trasig indata, aldrig ett halvräknat svar.
    expect(foilProbeFromRgb(new Uint8Array(10), 96, 132, 4)).toBeNull();
  });
});

describe("regionmasken", () => {
  it("delar rutnätet i 24 konstceller och 56 kroppsceller", () => {
    // 4 rader × 6 kolumner konst, 8 kantceller på samma rader + 6 hela rader
    // utanför konstfönstret = 56 kropp. Rad 5 (8 celler) tillhör ingendera.
    expect(ART_CELLS).toHaveLength(24);
    expect(BODY_CELLS).toHaveLength(56);
    // Gränsraden (rad 5) tillhör ingen region — hellre rena celler än blandade.
    expect(ART_CELLS.length + BODY_CELLS.length).toBe(PROBE_CELLS - GRID_W);
  });

  it("lägger ram och textruta i kroppen, konstfönstret i konsten", () => {
    expect(cellRegion(0)).toBe("body"); // övre vänstra hörnet (namnraden)
    expect(cellRegion(1 * GRID_W + 3)).toBe("art"); // mitt i konstfönstret
    expect(cellRegion(4 * GRID_W + 0)).toBe("body"); // vänsterramen
    expect(cellRegion(5 * GRID_W + 3)).toBeNull(); // gränsraden
    expect(cellRegion(8 * GRID_W + 3)).toBe("body"); // attacktexten
  });
});

describe("måtten", () => {
  const flat = () => new Int8Array(PROBE_CELLS * 3);

  it("pekar ut den region som avviker mot referensen", () => {
    const ref = flat();
    const query = flat();
    // Bara kortkroppen avviker — reverse holo-hypotesen.
    for (const cell of BODY_CELLS) query[cell] = 60;
    const dev = deviationByRegion(query, ref)!;
    expect(dev.art).toBe(0);
    expect(dev.body).toBeGreaterThan(0);
    // Konstfönstret identiskt ⇒ ingen kvot, aldrig Infinity.
    expect(dev.ratio).toBeNull();

    // Och åt andra hållet: en holo rare avviker i konsten.
    const holo = flat();
    for (const cell of ART_CELLS) holo[cell] = 60;
    const devHolo = deviationByRegion(holo, ref)!;
    expect(devHolo.art).toBeGreaterThan(devHolo.body);
  });

  it("kräver rätt längder — annars inget mått alls", () => {
    expect(deviationByRegion(new Int8Array(10), flat())).toBeNull();
    expect(deviationByRegion(flat(), new Int8Array(10))).toBeNull();
  });

  it("mäter temporal rörelse bara när det finns flera rutor", () => {
    const still = new Uint8Array(PROBE_BYTES).fill(120);
    expect(temporalByRegion([still])).toBeNull();
    expect(temporalByRegion([])).toBeNull();
    // Två identiska rutor = ingen rörelse.
    const steady = temporalByRegion([still, still])!;
    expect(steady.art).toBe(0);
    expect(steady.body).toBe(0);
    expect(steady.frames).toBe(2);

    // Kroppen blänker mellan rutorna, konsten står still.
    const a = new Uint8Array(PROBE_BYTES).fill(120);
    const b = new Uint8Array(PROBE_BYTES).fill(120);
    for (const cell of BODY_CELLS) b[PROBE_LUM * PROBE_CELLS + cell] = 200;
    const moving = temporalByRegion([a, b])!;
    expect(moving.body).toBeGreaterThan(moving.art);
    expect(moving.art).toBe(0);
  });

  it("hoppar över sonder med fel längd i stället för att jämföra äpplen och päron", () => {
    const ok = new Uint8Array(PROBE_BYTES).fill(120);
    expect(temporalByRegion([ok, new Uint8Array(10)])).toBeNull();
  });

  it("summerar klippning, textur och kroma per region", () => {
    const probe = new Uint8Array(PROBE_BYTES);
    for (const cell of BODY_CELLS) probe[PROBE_CLIP * PROBE_CELLS + cell] = 255;
    const spec = specularByRegion(probe)!;
    expect(spec.clip.body).toBe(1);
    expect(spec.clip.art).toBe(0);
    expect(spec.clip.ratio).toBeNull(); // nämnaren är noll — ingen påhittad kvot
  });

  it("ger null per signal när indata saknas, aldrig nollor", () => {
    const m = foilMetrics({ probe: null });
    expect(m.dev).toBeNull();
    expect(m.temporal).toBeNull();
    expect(m.spec).toBeNull();
  });
});
