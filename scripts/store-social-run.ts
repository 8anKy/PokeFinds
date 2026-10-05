/**
 * BUTIKSNYHETER: butikernas Instagram-inlägg om Pokémon-släpp → Discord (2026-10-05).
 *
 *   npx tsx scripts/store-social-run.ts              # drift (store-social.yml)
 *   npx tsx scripts/store-social-run.ts --dry --days=14   # läs + döm, posta/spara inget
 *   npx tsx scripts/store-social-run.ts --test       # ett märkt testinlägg i kanalen
 *
 * KÄLLA: Metas Business Discovery (gratis, officiell) — vårt eget professionella IG-konto
 * läser andra butikskontons senaste inlägg. EN förfrågan per butik och körning.
 * ⛔ Taket är 200 anrop/timme: varje konto = ett anrop per körning; ~3 körningar/h. Läs `rateLimited()`
 *    innan takten höjs. 429-motsvarigheten (kod 4/17/32/613) = SLUTA, aldrig retry.
 * ⛔ Facebook och TikTok ingår INTE (ägarbeslut): Facebook-sidor kräver en appgranskning
 *    vi inte klarar, TikTok har inget officiellt läs-API. Stories syns inte i API:t.
 * ⛔ Rör ALDRIG databasen — lanen kör var ~20:e minut. Setnamnen kommer ur
 *    ruttabellen (`.restock-routes/routes.json`) som nattkedjan redan skriver.
 * ⛔ Ingen AI (ägarbeslut): domen är `classifyStorePost` (src/lib/store-social-filter.ts).
 * ⛔ Vi återger aldrig hela inlägget: ett utdrag + länk UT, samma regel som nyhetsflödet.
 *
 * STATE (Actions-cache): vilka inlägg som redan dömts. En butik som är NY för lanen
 * seedas tyst — första körningen postar ingenting, annars hade 39 butikers senaste
 * inlägg vällt ut i kanalen. Inlägg äldre än `MAX_AGE_HOURS` postas aldrig, så ett
 * tappat state ger tystnad, inte en flod.
 */
import fs from "node:fs";
import path from "node:path";
import { discordFetch } from "../src/lib/discord";
import { captionBody, classifyStorePost, pokemonTermsFromSetNames } from "../src/lib/store-social-filter";
import stores from "../src/data/store-instagram.json";

const G = "https://graph.facebook.com/v26.0";
const MEDIA_PER_STORE = 12;
const MAX_AGE_HOURS = 48;
const SEEN_TTL_DAYS = 120;
const EXCERPT_CHARS = 350;
const COLOR = 0x2dd4bf;

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const TEST = args.includes("--test");
/** Postar det SENASTE riktiga släppinlägget (oavsett ålder) som exempel. Rör inte state. */
const PREVIEW = args.includes("--preview");
const DRY_DAYS = Number(args.find((a) => a.startsWith("--days="))?.slice(7) ?? 14);

const token = process.env.META_ACCESS_TOKEN?.trim() ?? "";
const igUserId = process.env.META_IG_USER_ID?.trim() ?? "";
const botToken = process.env.DISCORD_BOT_TOKEN?.trim() ?? "";
const channelId = process.env.STORE_SOCIAL_CHANNEL_ID?.trim() ?? "";
const stateFile = process.env.STORE_SOCIAL_STATE_FILE ?? ".store-social-cache/state.json";
const routesFile = process.env.RESTOCK_ROUTES_FILE ?? ".restock-routes/routes.json";

interface Media {
  id: string;
  caption?: string;
  timestamp: string;
  permalink: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
}
interface State {
  /** Handtag som lanen redan har baslinje för. */
  seeded: string[];
  /** media-id → inläggets tidpunkt (ISO). */
  seen: Record<string, string>;
}
type Fetched = { ok: true; media: Media[] } | { ok: false; stop: boolean; error: string };

function readState(): State {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return { seeded: s.seeded ?? [], seen: s.seen ?? {} };
  } catch {
    return { seeded: [], seen: {} };
  }
}

function writeState(s: State) {
  const cutoff = Date.now() - SEEN_TTL_DAYS * 864e5;
  for (const [id, ts] of Object.entries(s.seen)) if (Date.parse(ts) < cutoff) delete s.seen[id];
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(s));
}

function setTerms(): string[] {
  try {
    const routes = JSON.parse(fs.readFileSync(routesFile, "utf8")) as Record<string, { setName?: string | null }>;
    return pokemonTermsFromSetNames(Object.values(routes).map((r) => r.setName));
  } catch {
    return [];
  }
}

/** Metas förbrukning i procent (högst av app- och kontonivå). ≥ 90 ⇒ sluta för den här gången. */
function usagePercent(res: Response): number {
  let max = 0;
  for (const h of ["x-app-usage", "x-business-use-case-usage"]) {
    const raw = res.headers.get(h);
    if (!raw) continue;
    try {
      const json = JSON.parse(raw);
      const rows = Array.isArray(json) ? json : Object.values(json).flat();
      for (const r of [json, ...rows] as Record<string, number>[]) {
        for (const k of ["call_count", "total_time", "total_cputime"]) {
          if (typeof r?.[k] === "number") max = Math.max(max, r[k]);
        }
      }
    } catch {
      /* okänt format — ignorera */
    }
  }
  return max;
}

let usage = 0;
async function fetchMedia(handle: string): Promise<Fetched> {
  const fields =
    `business_discovery.username(${handle}){media.limit(${MEDIA_PER_STORE})` +
    `{id,caption,timestamp,permalink,media_type,media_url,thumbnail_url}}`;
  const res = await fetch(`${G}/${igUserId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  usage = Math.max(usage, usagePercent(res));
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code: number; message: string };
    business_discovery?: { media?: { data?: Media[] } };
  };
  if (body.error) {
    const { code, message } = body.error;
    // Token ogiltig/utgången: kasta ⇒ röd körning (GitHub mejlar ägaren).
    if (code === 190) throw new Error(`META_ACCESS_TOKEN ogiltig (190): ${message}`);
    const stop = [4, 17, 32, 613, 80002].includes(code);
    return { ok: false, stop, error: `${code}: ${message}` };
  }
  return { ok: true, media: body.business_discovery?.media?.data ?? [] };
}

function embedFor(store: string, handle: string, m: Media) {
  const body = captionBody(m.caption ?? "");
  const excerpt = body.length > EXCERPT_CHARS ? `${body.slice(0, EXCERPT_CHARS).trimEnd()}…` : body;
  const thumb = m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url;
  return {
    color: COLOR,
    author: { name: `${store} (@${handle})`, url: `https://www.instagram.com/${handle}/` },
    title: m.media_type === "VIDEO" ? "Ny reel på Instagram" : "Nytt inlägg på Instagram",
    url: m.permalink,
    description: excerpt || undefined,
    ...(thumb ? { thumbnail: { url: thumb } } : {}),
    footer: { text: "Butiksnyheter · Foilio" },
    timestamp: m.timestamp,
  };
}

async function post(embed: object): Promise<boolean> {
  const res = await discordFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    authorization: `Bot ${botToken}`,
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (res.ok) return true;
  console.error(`[store-social] Discord ${res.status}: ${await res.text().catch(() => "")}`);
  return false;
}

async function main() {
  if (!token || !igUserId) throw new Error("META_ACCESS_TOKEN / META_IG_USER_ID saknas");
  if (!DRY && (!botToken || !channelId)) throw new Error("DISCORD_BOT_TOKEN / STORE_SOCIAL_CHANNEL_ID saknas");

  if (TEST) {
    const ok = await post({
      color: COLOR,
      title: "Testinlägg: butiksnyheter",
      description: "Butikernas Instagram-inlägg om Pokémon-släpp hamnar i den här kanalen.",
      footer: { text: "Butiksnyheter · Foilio" },
    });
    if (!ok) process.exit(1);
    console.log("[store-social] Testinlägget postades.");
    return;
  }

  const terms = setTerms();

  if (PREVIEW) {
    let best: { store: string; handle: string; m: Media } | null = null;
    for (const { store, handle } of stores) {
      const r = await fetchMedia(handle);
      if (!r.ok) continue;
      for (const m of r.media) {
        if (!classifyStorePost(m.caption ?? "", terms).relevant) continue;
        if (!best || m.timestamp > best.m.timestamp) best = { store, handle, m };
      }
    }
    if (!best) throw new Error("Inget släppinlägg hittades att visa som exempel");
    if (!(await post(embedFor(best.store, best.handle, best.m)))) process.exit(1);
    console.log(`[store-social] Exempel postat: ${best.store} ${best.m.permalink}`);
    return;
  }

  const state = readState();
  const seeded = new Set(state.seeded);
  const queue: { store: string; handle: string; m: Media; reason: string }[] = [];
  const dryCutoff = Date.now() - DRY_DAYS * 864e5;
  const ageCutoff = Date.now() - MAX_AGE_HOURS * 36e5;
  let fetched = 0;
  let skipped = 0;
  let stopped = false;

  for (const { store, handle } of stores) {
    if (usage >= 90) {
      console.warn(`[store-social] Metas förbrukning ${usage} % — slutar, resten tas nästa körning.`);
      stopped = true;
      break;
    }
    const r = await fetchMedia(handle);
    if (!r.ok) {
      console.warn(`[store-social] @${handle} (${store}): ${r.error}`);
      if (r.stop) {
        console.warn("[store-social] Rate limit — slutar utan retry.");
        stopped = true;
        break;
      }
      continue;
    }
    fetched++;

    if (DRY) {
      for (const m of r.media) {
        if (Date.parse(m.timestamp) < dryCutoff) continue;
        const v = classifyStorePost(m.caption ?? "", terms);
        const why = v.relevant ? v.reason : `${v.reason}${"detail" in v && v.detail ? `:${v.detail}` : ""}`;
        console.log(
          `${v.relevant ? "POST" : "skip"}  ${m.timestamp.slice(0, 10)}  ${store}  [${why}]  ` +
            `${captionBody(m.caption ?? "").slice(0, 90)}`
        );
      }
      continue;
    }

    const firstTime = !seeded.has(handle);
    for (const m of r.media) {
      if (state.seen[m.id]) continue;
      state.seen[m.id] = m.timestamp;
      if (firstTime || Date.parse(m.timestamp) < ageCutoff) continue;
      const v = classifyStorePost(m.caption ?? "", terms);
      if (v.relevant) queue.push({ store, handle, m, reason: v.reason });
      else {
        skipped++;
        console.log(`[store-social] skip ${store}: ${v.reason}${"detail" in v && v.detail ? ` (${v.detail})` : ""} ${m.permalink}`);
      }
    }
    if (firstTime) {
      seeded.add(handle);
      console.log(`[store-social] @${handle} seedad (${r.media.length} inlägg, inget postat).`);
    }
  }

  if (DRY) {
    console.log(`\n[store-social] torrkörning: ${fetched}/${stores.length} butiker lästa, ${terms.length} setnamn, förbrukning ${usage} %`);
    return;
  }

  let sent = 0;
  for (const q of queue.sort((a, b) => a.m.timestamp.localeCompare(b.m.timestamp))) {
    if (await post(embedFor(q.store, q.handle, q.m))) {
      sent++;
      console.log(`[store-social] postad ${q.store} [${q.reason}] ${q.m.permalink}`);
    } else {
      delete state.seen[q.m.id]; // nästa körning försöker igen (inom MAX_AGE_HOURS)
    }
  }

  state.seeded = [...seeded];
  writeState(state);
  console.log(
    `[store-social] ${fetched}/${stores.length} butiker lästa, ${sent} postade, ${skipped} fällda av filtret, ` +
      `förbrukning ${usage} %${stopped ? " (avbruten tidigt)" : ""}`
  );
  if (sent < queue.length) process.exit(1);
}

main().catch((e) => {
  console.error(`[store-social] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
