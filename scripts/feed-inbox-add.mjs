#!/usr/bin/env node
/**
 * LÄGGER UTKAST I NYHETSINKORGEN (`.github/feed/inbox.json`).
 *
 *   node scripts/feed-inbox-add.mjs utkast.json
 *   node scripts/feed-inbox-add.mjs utkast.json --dry
 *
 * `utkast.json` är en lista med utkast (formen: `src/lib/feed-inbox.ts`). En rad med
 * `kind: "event"` (eller ett `startsAt`) är ett EVENEMANGSUTKAST och hamnar i
 * `eventDrafts`; övriga är nyheter och hamnar i `drafts`. Skriptet sätter `id`, hoppar
 * över allt rutinen redan sett (`seen`), städar gamla utkast och skriver filen.
 * Slutraden säger hur många som lades till.
 *
 * ⛔ AVSIKTLIGT UTAN BEROENDEN (ren Node ≥ 18, inget zod, inget tsx): det körs av
 *    molnrutinen i ett färskt klon där `npm ci` inte är gjort. Den STRIKTA
 *    valideringen sker ändå i `scripts/feed-build.ts` när jobbet läser filen —
 *    ett felformat utkast varnas om där och hoppas över, det når aldrig admin.
 * ⛔ `stableId` är en KOPIA av den i `src/lib/feed.ts` och måste ge samma tal —
 *    `tests/unit/feed-inbox.test.ts` vaktar pariteten. Skiljer de sig får samma
 *    nyhet två id:n och `seen` slutar fungera.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const INBOX = path.join(process.cwd(), ".github", "feed", "inbox.json");
const CATEGORIES = new Set(["RELEASE", "MARKET", "STORE", "APP"]);
const EVENT_CATEGORIES = new Set(["EXPO", "PRERELEASE", "TOURNAMENT", "OTHER"]);
const DRAFT_KEEP_DAYS = 30;
const SEEN_MAX = 1500;

export function stableId(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let g = 0x811c9dc5;
  for (let i = input.length - 1; i >= 0; i--) {
    g ^= input.charCodeAt(i);
    g = Math.imul(g, 0x01000193) >>> 0;
  }
  return h.toString(36) + g.toString(36);
}

/** Spårningsparametrar bort så samma artikel ur två nyhetsbrev får samma id. */
export function cleanUrl(raw) {
  const u = new URL(String(raw).trim());
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|mc_|fbclid|gclid|_ke|_kx|ref$|source$|campaign)/i.test(key)) u.searchParams.delete(key);
  }
  u.hash = "";
  return u.toString();
}

function isoOrNull(v) {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Grov formkoll så en trasig rad syns HÄR, i rutinens logg, och inte först i jobbet. */
export function validateDraft(raw, now = new Date()) {
  const errors = [];
  const d = raw && typeof raw === "object" ? raw : {};
  let url = null;
  try {
    url = cleanUrl(d.url);
    if (!/^https?:\/\//i.test(url)) errors.push("url måste vara http(s)");
  } catch {
    errors.push("url saknas eller är ogiltig");
  }
  if (typeof d.title !== "string" || d.title.trim().length < 3 || d.title.length > 300) errors.push("title 3–300 tecken");
  if (typeof d.summary !== "string" || d.summary.trim().length < 1 || d.summary.length > 600) errors.push("summary 1–600 tecken");
  if (typeof d.source !== "string" || d.source.trim().length < 1 || d.source.length > 80) errors.push("source 1–80 tecken");
  const category = d.category ?? "MARKET";
  if (!CATEGORIES.has(category)) errors.push(`category måste vara en av ${[...CATEGORIES].join("/")}`);
  const publishedAt = isoOrNull(d.publishedAt);
  if (!publishedAt) errors.push("publishedAt måste vara ett datum");
  let imageUrl = null;
  if (d.imageUrl != null && d.imageUrl !== "") {
    if (typeof d.imageUrl === "string" && /^https?:\/\//i.test(d.imageUrl)) imageUrl = d.imageUrl;
    else errors.push("imageUrl måste vara https://");
  }
  const origin = d.origin ?? "web";
  if (origin !== "email" && origin !== "web") errors.push("origin måste vara email eller web");
  let body = [];
  if (d.body != null) {
    if (!Array.isArray(d.body) || d.body.some((p) => typeof p !== "string")) errors.push("body måste vara en lista med textstycken");
    else {
      body = d.body.map((p) => p.trim()).filter(Boolean);
      if (body.length > 12) errors.push("body max 12 stycken");
      if (body.some((p) => p.length > 1500)) errors.push("ett stycke i body är längre än 1500 tecken");
    }
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    draft: {
      id: stableId(url),
      title: d.title.trim(),
      summary: d.summary.trim(),
      url,
      source: d.source.trim(),
      category,
      publishedAt,
      imageUrl,
      imageFit: d.imageFit === "contain" ? "contain" : "cover",
      origin,
      note: typeof d.note === "string" ? d.note.slice(0, 400) : "",
      foundAt: now.toISOString(),
      body,
    },
  };
}

/** Slug som i src/lib/feed.ts (kopia — bara för evenemangets id-nyckel). */
function slugifyLite(input) {
  return String(input)
    .toLowerCase()
    .replace(/[åä]/g, "a").replace(/ö/g, "o").replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function optUrl(v, errors, field) {
  if (v == null || v === "") return null;
  try {
    const u = cleanUrl(v);
    if (!/^https?:\/\//i.test(u)) throw new Error();
    return u;
  } catch {
    errors.push(`${field} måste vara https://`);
    return null;
  }
}

function optText(v, max) {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export function isEventDraft(raw) {
  return !!raw && typeof raw === "object" && (raw.kind === "event" || typeof raw.startsAt === "string");
}

/** Evenemangsutkast: samma grova formkoll. Id = arrangörens länk, annars namn + startdatum (som appen). */
export function validateEventDraft(raw, now = new Date()) {
  const errors = [];
  const d = raw && typeof raw === "object" ? raw : {};
  if (typeof d.title !== "string" || d.title.trim().length < 3 || d.title.length > 200) errors.push("title 3–200 tecken");
  if (typeof d.summary !== "string" || d.summary.trim().length < 1 || d.summary.length > 600) errors.push("summary 1–600 tecken");
  const category = d.category ?? "EXPO";
  if (!EVENT_CATEGORIES.has(category)) errors.push(`category måste vara en av ${[...EVENT_CATEGORIES].join("/")}`);
  const startsAt = typeof d.startsAt === "string" && !Number.isNaN(Date.parse(d.startsAt)) ? d.startsAt : null;
  if (!startsAt) errors.push("startsAt måste vara ett datum (ISO med tidszon)");
  const endsAt = d.endsAt == null || d.endsAt === "" ? null : !Number.isNaN(Date.parse(d.endsAt)) ? d.endsAt : (errors.push("endsAt måste vara ett datum"), null);
  const mapUrl = optUrl(d.mapUrl, errors, "mapUrl");
  const ticketUrl = optUrl(d.ticketUrl, errors, "ticketUrl");
  const infoUrl = optUrl(d.infoUrl, errors, "infoUrl");
  const imageUrl = optUrl(d.imageUrl, errors, "imageUrl");
  if (!ticketUrl && !infoUrl) errors.push("infoUrl eller ticketUrl krävs — arrangörens sida är källan");
  const origin = d.origin ?? "web";
  if (origin !== "email" && origin !== "web") errors.push("origin måste vara email eller web");
  let body = [];
  if (d.body != null) {
    if (!Array.isArray(d.body) || d.body.some((p) => typeof p !== "string")) errors.push("body måste vara en lista med textstycken");
    else body = d.body.map((p) => p.trim()).filter(Boolean).slice(0, 12);
  }
  if (errors.length) return { ok: false, errors };
  const key = infoUrl || ticketUrl || `${slugifyLite(d.title)}|${startsAt.slice(0, 10)}`;
  return {
    ok: true,
    draft: {
      id: stableId(key.trim()),
      title: d.title.trim(),
      category,
      startsAt,
      endsAt,
      city: optText(d.city, 80),
      venue: optText(d.venue, 160),
      address: optText(d.address, 200),
      mapUrl,
      ticketUrl,
      infoUrl,
      imageUrl,
      imageFit: d.imageFit === "contain" ? "contain" : "cover",
      organizer: optText(d.organizer, 120),
      summary: d.summary.trim(),
      body,
      origin,
      note: typeof d.note === "string" ? d.note.slice(0, 400) : "",
      foundAt: now.toISOString(),
    },
  };
}

/** Ren dom: befintlig fil + nya råutkast ⇒ ny fil + rapport. */
export function addDrafts(file, rawDrafts, now = new Date()) {
  const drafts = Array.isArray(file.drafts) ? [...file.drafts] : [];
  const eventDrafts = Array.isArray(file.eventDrafts) ? [...file.eventDrafts] : [];
  const seen = Array.isArray(file.seen) ? [...file.seen] : [];
  const seenIds = new Set([...seen.map((s) => s.id), ...drafts.map((d) => d.id), ...eventDrafts.map((d) => d.id)]);
  const report = { added: 0, addedEvents: 0, skippedSeen: 0, invalid: [] };

  for (const raw of rawDrafts) {
    const isEvent = isEventDraft(raw);
    const v = isEvent ? validateEventDraft(raw, now) : validateDraft(raw, now);
    if (!v.ok) {
      report.invalid.push({ title: raw?.title ?? "(utan rubrik)", errors: v.errors });
      continue;
    }
    if (seenIds.has(v.draft.id)) {
      report.skippedSeen++;
      continue;
    }
    seenIds.add(v.draft.id);
    if (isEvent) {
      eventDrafts.push(v.draft);
      seen.push({ id: v.draft.id, url: v.draft.infoUrl || v.draft.ticketUrl || "", at: now.toISOString() });
      report.addedEvents++;
    } else {
      drafts.push(v.draft);
      seen.push({ id: v.draft.id, url: v.draft.url, at: now.toISOString() });
      report.added++;
    }
  }

  const cutoff = now.getTime() - DRAFT_KEEP_DAYS * 86_400_000;
  const kept = drafts.filter((d) => Date.parse(d.foundAt) >= cutoff);
  // Ett evenemang ligger kvar tills det har varit — ägaren kan godkänna det sent.
  const keptEvents = eventDrafts.filter((d) => Date.parse(d.endsAt || d.startsAt) >= now.getTime() - 86_400_000);
  // Nyast sist, äldst först — och taket tar de äldsta.
  const trimmedSeen = seen.slice(Math.max(0, seen.length - SEEN_MAX));

  return { file: { ...file, drafts: kept, eventDrafts: keptEvents, seen: trimmedSeen }, report };
}

function main() {
  const [, , input, ...flags] = process.argv;
  if (!input) {
    console.error("användning: node scripts/feed-inbox-add.mjs <utkast.json> [--dry]");
    process.exit(2);
  }
  const dry = flags.includes("--dry");
  const file = JSON.parse(readFileSync(INBOX, "utf8"));
  const rawList = JSON.parse(readFileSync(input, "utf8"));
  const rawDrafts = Array.isArray(rawList) ? rawList : Array.isArray(rawList?.drafts) ? rawList.drafts : [];

  const { file: next, report } = addDrafts(file, rawDrafts);
  for (const bad of report.invalid) console.error(`[inbox] ogiltigt utkast "${bad.title}": ${bad.errors.join("; ")}`);
  console.log(
    `[inbox] ${report.added} nya nyheter, ${report.addedEvents} nya evenemang, ${report.skippedSeen} redan sedda, ${report.invalid.length} ogiltiga ⇒ ` +
      `${next.drafts.length} nyhetsutkast + ${next.eventDrafts.length} evenemangsutkast i filen.`
  );

  if (dry) return;
  if (report.added === 0 && report.addedEvents === 0 && next.drafts.length === (file.drafts?.length ?? 0) && next.eventDrafts.length === (file.eventDrafts?.length ?? 0)) {
    console.log("[inbox] ingenting att skriva.");
    return;
  }
  writeFileSync(INBOX, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`[inbox] skrev ${INBOX}`);
}

// Bara som skript — testet importerar funktionerna utan att köra main().
if (process.argv[1] && path.basename(process.argv[1]) === "feed-inbox-add.mjs") main();
