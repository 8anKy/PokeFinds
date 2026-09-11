/**
 * Nyhetsinkorgen: sammanslagningen som aldrig får skriva över ett beslut, den
 * godkända posten som ALLTID hamnar i lane `curated`, och pariteten mellan
 * rutinens beroendefria `stableId` och appens — skiljer de sig får samma nyhet
 * två id:n och rutinens `seen`-minne slutar fungera.
 */
import { describe, expect, it } from "vitest";
import { JOB_LANES, feedPublishSchema, stableId } from "@/lib/feed";
import {
  DECIDED_KEEP_DAYS,
  PENDING_KEEP_DAYS,
  approveInputSchema,
  draftToNewsItem,
  feedDraftSchema,
  mergeInbox,
  type InboxDocument,
  type InboxEntry,
} from "@/lib/feed-inbox";
import { addDrafts, cleanUrl, stableId as scriptStableId, validateDraft } from "../../scripts/feed-inbox-add.mjs";

const NOW = new Date("2026-09-11T05:00:00Z");

function draft(url: string, over: Partial<InboxEntry> = {}) {
  return feedDraftSchema.parse({
    id: stableId(url),
    title: "Förbokningen öppnar 26 september",
    summary: "Butiken öppnar förbokningen kl 10.",
    url,
    source: "Cardshop Sweden",
    category: "STORE",
    publishedAt: "2026-09-10",
    origin: "email",
    foundAt: NOW.toISOString(),
    ...over,
  });
}

function entry(url: string, over: Partial<InboxEntry> = {}): InboxEntry {
  return { ...draft(url), status: "pending", receivedAt: NOW.toISOString(), decidedAt: null, ...over };
}

describe("mergeInbox", () => {
  it("nya id:n blir väntande, kända rader rörs inte", () => {
    const current: InboxDocument = {
      updatedAt: "2026-09-10T00:00:00Z",
      items: [entry("https://a.se/1", { status: "rejected", decidedAt: "2026-09-10T12:00:00Z", title: "Avvisad" })],
    };
    const next = mergeInbox(
      current,
      { generatedAt: NOW.toISOString(), drafts: [draft("https://a.se/1", { title: "Ny rubrik från rutinen" }), draft("https://a.se/2")] },
      NOW
    );
    expect(next.items).toHaveLength(2);
    const old = next.items.find((i) => i.url === "https://a.se/1")!;
    expect(old.status).toBe("rejected");
    expect(old.title).toBe("Avvisad");
    expect(next.items.find((i) => i.url === "https://a.se/2")!.status).toBe("pending");
  });

  it("städar på ålder: väntande på publishedAt, avgjorda på beslutsdatum", () => {
    const stale = new Date(NOW.getTime() - (PENDING_KEEP_DAYS + 1) * 86_400_000).toISOString();
    const oldDecision = new Date(NOW.getTime() - (DECIDED_KEEP_DAYS + 1) * 86_400_000).toISOString();
    const current: InboxDocument = {
      updatedAt: NOW.toISOString(),
      items: [
        entry("https://a.se/gammal", { publishedAt: stale }),
        entry("https://a.se/beslutad", { status: "approved", decidedAt: oldDecision, publishedAt: stale }),
        entry("https://a.se/kvar", { status: "approved", decidedAt: NOW.toISOString(), publishedAt: stale }),
      ],
    };
    const next = mergeInbox(current, { generatedAt: NOW.toISOString(), drafts: [] }, NOW);
    expect(next.items.map((i) => i.url)).toEqual(["https://a.se/kvar"]);
  });

  it("fyller i brödtext på ett väntande utkast som saknar den — men rör aldrig andra fält eller avgjorda rader", () => {
    const current: InboxDocument = {
      updatedAt: "2026-09-10T00:00:00Z",
      items: [
        entry("https://a.se/1", { title: "Ägarens rubrik" }),
        entry("https://a.se/2", { status: "approved", decidedAt: NOW.toISOString() }),
      ],
    };
    const next = mergeInbox(
      current,
      {
        generatedAt: NOW.toISOString(),
        drafts: [
          draft("https://a.se/1", { title: "Rutinens nya rubrik", body: ["Ett stycke."] }),
          draft("https://a.se/2", { body: ["Ska aldrig in."] }),
        ],
      },
      NOW
    );
    const a = next.items.find((i) => i.url === "https://a.se/1")!;
    expect(a.body).toEqual(["Ett stycke."]);
    expect(a.title).toBe("Ägarens rubrik");
    expect(next.items.find((i) => i.url === "https://a.se/2")!.body).toEqual([]);
    expect(next.updatedAt).toBe(NOW.toISOString());
  });

  it("en oförändrad leverans lämnar updatedAt orörd", () => {
    const current: InboxDocument = { updatedAt: "2026-09-10T00:00:00Z", items: [entry("https://a.se/1")] };
    const next = mergeInbox(current, { generatedAt: NOW.toISOString(), drafts: [draft("https://a.se/1")] }, NOW);
    expect(next.updatedAt).toBe(current.updatedAt);
  });
});

describe("godkännandet", () => {
  it("landar i lane curated, utan slug och body, med utkastets id", () => {
    const e = entry("https://a.se/1");
    const item = draftToNewsItem(
      e,
      approveInputSchema.parse({
        title: "Rättad rubrik",
        summary: "Rättad ingress.",
        url: e.url,
        source: e.source,
        category: "RELEASE",
        publishedAt: e.publishedAt,
        imageUrl: "/api/feed-cover/abc-deadbeef.jpg",
        imageFit: "contain",
        body: [],
      })
    );
    expect(item.lane).toBe("curated");
    expect(item.id).toBe(e.id);
    expect(item.slug).toBeNull();
    expect(item.body).toEqual([]);
    expect(item.internal).toBe(false);
    expect(item.imageUrl).toBe("/api/feed-cover/abc-deadbeef.jpg");
  });

  it("⛔ curated kan aldrig skickas till feed-publish — lanen ersätts i klump där", () => {
    expect(JOB_LANES).not.toContain("curated");
    const r = feedPublishSchema.safeParse({ lane: "curated", generatedAt: NOW.toISOString(), news: [] });
    expect(r.success).toBe(false);
  });

  it("utkast har aldrig egen slug — den härleds ur den GODKÄNDA rubriken när det finns en brödtext", () => {
    expect("slug" in feedDraftSchema.shape).toBe(false);
    const e = entry("https://a.se/2");
    const base = {
      title: "Rättad rubrik om Mega Evolution",
      summary: "Ingress.",
      url: e.url,
      source: e.source,
      category: "RELEASE" as const,
      publishedAt: e.publishedAt,
      imageUrl: null,
      imageFit: "cover" as const,
    };
    const withBody = draftToNewsItem(e, approveInputSchema.parse({ ...base, body: ["## Vad som kommer", "Första stycket.", "  ", "Andra stycket."] }));
    expect(withBody.slug).toBe("rattad-rubrik-om-mega-evolution");
    expect(withBody.body).toEqual([
      { type: "h", text: "Vad som kommer" },
      { type: "p", text: "Första stycket." },
      { type: "p", text: "Andra stycket." },
    ]);
    const noBody = draftToNewsItem(e, approveInputSchema.parse({ ...base, body: [] }));
    expect(noBody.slug).toBeNull();
    expect(noBody.body).toEqual([]);
  });
});

describe("scripts/feed-inbox-add.mjs (rutinens beroendefria hjälpare)", () => {
  it("stableId ger samma tal som appens", () => {
    for (const s of ["https://foilio.se/x", "https://www.exempel.se/products/etb?a=1", "åäö", ""]) {
      expect(scriptStableId(s)).toBe(stableId(s));
    }
  });

  it("rensar spårningsparametrar så två nyhetsbrev ger ett id", () => {
    expect(cleanUrl("https://x.se/p/etb?utm_source=klaviyo&utm_medium=email&variant=1#top")).toBe("https://x.se/p/etb?variant=1");
  });

  it("validerar och hoppar över redan sedda, och det den lägger till klarar appens schema", () => {
    const file = { drafts: [], seen: [{ id: stableId("https://x.se/sedd"), url: "https://x.se/sedd", at: NOW.toISOString() }] };
    const raw = [
      { title: "Ny nyhet", summary: "Ingress.", url: "https://x.se/ny?utm_source=a", source: "Butik", category: "STORE", publishedAt: "2026-09-11", origin: "email", body: ["Stycke ett.", "", "Stycke två."] },
      { title: "Sedd", summary: "Ingress.", url: "https://x.se/sedd", source: "Butik", publishedAt: "2026-09-11" },
      { title: "Trasig", summary: "", url: "inte-en-url", source: "", publishedAt: "igår" },
    ];
    const { file: next, report } = addDrafts(file, raw, NOW);
    expect(report).toMatchObject({ added: 1, skippedSeen: 1 });
    expect(report.invalid).toHaveLength(1);
    expect(next.drafts).toHaveLength(1);
    expect(next.drafts[0].url).toBe("https://x.se/ny");
    expect(next.drafts[0].body).toEqual(["Stycke ett.", "Stycke två."]);
    expect(next.seen).toHaveLength(2);
    expect(feedDraftSchema.safeParse(next.drafts[0]).success).toBe(true);
  });

  it("validateDraft sätter id ur den rensade URL:en", () => {
    const v = validateDraft({ title: "Rubrik", summary: "Text", url: "https://x.se/a?fbclid=1", source: "S", publishedAt: "2026-09-11" }, NOW);
    expect(v.ok).toBe(true);
    expect(v.draft?.id).toBe(stableId("https://x.se/a"));
  });
});
