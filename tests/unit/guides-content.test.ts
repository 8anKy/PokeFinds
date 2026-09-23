/**
 * Guiderna (`src/content/guides.ts`) redigeras för hand — vakten fångar de fel som
 * annars går rakt igenom typkontrollen: dubbla slugs, en extern länk i ett
 * `links`-block (som är INTERNA vägar), ett datum som inte är ISO, och ett pris
 * i brödtexten (sidan är statisk; ett pris i löptext är fel dagen efter).
 */
import { describe, expect, it } from "vitest";
import { GUIDES, guideForSet, guidesNewestFirst } from "@/content/guides";

const allText = (g: (typeof GUIDES)[number]) =>
  [
    g.title,
    g.description,
    g.intro,
    ...(g.facts ?? []).flatMap((f) => [f.label, f.value]),
    ...g.body.flatMap((b) =>
      b.type === "list"
        ? b.items
        : b.type === "links"
          ? b.items.flatMap((i) => [i.label, i.note ?? ""])
          : b.type === "note"
            ? [b.title, b.text]
            : [b.text]
    ),
  ].join("\n");

describe("guider", () => {
  it("har unika, URL-säkra slugs", () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("länkblock pekar bara på interna vägar utan språkprefix", () => {
    for (const g of GUIDES) {
      for (const b of g.body) {
        if (b.type !== "links") continue;
        for (const item of b.items) {
          expect(item.href, `${g.slug}: ${item.href}`).toMatch(/^\/(?!en\/)[^\s]*$/);
        }
      }
    }
  });

  it("datum är ISO och uppdaterat är aldrig före publicerat", () => {
    for (const g of GUIDES) {
      expect(g.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(g.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(g.updatedAt >= g.publishedAt).toBe(true);
    }
  });

  it("brödtexten bär inga priser", () => {
    for (const g of GUIDES) {
      expect(allText(g), g.slug).not.toMatch(/\d[\d\s]*(?:kr|:-|SEK|€|\$)/i);
    }
  });

  it("källorna är riktiga webbadresser", () => {
    for (const g of GUIDES) for (const s of g.sources) expect(s.url).toMatch(/^https:\/\//);
  });

  it("ett set har högst en guide och guideForSet hittar den", () => {
    const withSet = GUIDES.filter((g) => g.setId);
    expect(new Set(withSet.map((g) => g.setId)).size).toBe(withSet.length);
    for (const g of withSet) expect(guideForSet(g.setId!)?.slug).toBe(g.slug);
  });

  it("listan har kalendern först och resten nyast först", () => {
    const list = guidesNewestFirst();
    const calendars = list.filter((g) => g.kind === "calendar");
    expect(list.slice(0, calendars.length)).toEqual(calendars);
    const dates = list.filter((g) => g.kind !== "calendar").map((g) => g.publishedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("interna guidelänkar pekar på guider som finns", () => {
    const slugs = new Set(GUIDES.map((g) => g.slug));
    for (const g of GUIDES)
      for (const b of g.body)
        if (b.type === "links")
          for (const i of b.items)
            if (i.href.startsWith("/guider/")) expect(slugs.has(i.href.slice(8)), `${g.slug} → ${i.href}`).toBe(true);
  });
});
