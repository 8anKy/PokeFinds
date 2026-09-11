"use client";

/**
 * Nyhetsinkorgen i admin: NYHETER och EVENEMANG, vardera med tre listor (väntar /
 * godkända / avvisade). Ett väntande utkast redigeras direkt i kortet och godkänns med
 * de rättade fälten — det finns inget "spara utkast", för godkännandet ÄR sparandet
 * (och rutinen skriver aldrig över en rad den redan levererat, se `mergeInbox`).
 *
 * Omslaget (`CoverPicker`, delas av båda kortsorterna): rutinens förslag ligger i
 * `imageUrl`; ägaren kan klistra in en annan URL eller ladda upp en egen bild, som
 * skalas ned i webbläsaren (≤ 1600 px, JPEG) innan den skickas — samma grepp som
 * forumets bildväljare, av samma skäl (storlek och EXIF). Bilden kan också SLÄPPAS på
 * omslaget eller KLISTRAS IN (Ctrl+V): en fil laddas upp, en bild dragen ur en annan
 * flik kommer som `text/html`/`text/uri-list` — en `data:`-URL blir en uppladdning, en
 * https-URL länkas direkt (som flödets externa bilder).
 *
 * Brödtexten redigeras som EN text: tom rad = nytt stycke, "## " = mellanrubrik.
 */
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { FeedCover } from "@/components/features/feed/feed-chrome";
import { EVENT_CATEGORIES, NEWS_CATEGORIES, type EventCategory, type NewsCategory } from "@/lib/feed";
import type { ApproveEventInput, ApproveInput, DraftStatus, InboxDocument, InboxEntry, InboxEventEntry } from "@/lib/feed-inbox";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<NewsCategory, string> = { RELEASE: "Släpp", MARKET: "Marknad", STORE: "Butik", APP: "Foilio" };
const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = { EXPO: "Mässa", PRERELEASE: "Prerelease", TOURNAMENT: "Turnering", OTHER: "Övrigt" };
const ORIGIN_LABEL = { email: "Nyhetsbrev", web: "Webben" } as const;
const STATUS_LABEL: Record<DraftStatus, string> = { pending: "Väntar", approved: "Godkända", rejected: "Avvisade" };

const dateFmt = new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" });
const stampFmt = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" });

function toDateInput(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** ISO med tidszon ⇒ värdet för `<input type="datetime-local">` i SVENSK tid. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** `datetime-local` (svensk tid) ⇒ ISO med rätt offset. Sommartid t.o.m. 2026-10-25. */
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const probe = new Date(`${v}:00Z`);
  const offsetMin = -stockholmOffsetMinutes(probe);
  const sign = offsetMin <= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${v}:00${sign}${hh}:${mm}`;
}

function stockholmOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Stockholm", timeZoneName: "shortOffset" }).formatToParts(at);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return -60;
  const sign = m[1] === "+" ? 1 : -1;
  return -sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

const MAX_EDGE = 1600;

/** Nedskalning i webbläsaren så servern aldrig behöver en bildbearbetare. */
async function downscale(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Kunde inte läsa bilden."));
      el.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Ingen canvas.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const keepPng = file.type === "image/png";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, keepPng ? "image/png" : "image/jpeg", keepPng ? undefined : 0.85)
    );
    if (!blob) throw new Error("Kunde inte koda bilden.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? "Något gick fel.");
  return data;
}

/* ------------------------------------------------------------------ */
/* Omslaget — delas av nyhets- och evenemangskorten                     */
/* ------------------------------------------------------------------ */

function CoverPicker({
  draftId,
  imageUrl,
  imageFit,
  category,
  onImage,
  onFit,
}: {
  draftId: string;
  imageUrl: string | null;
  imageFit: "cover" | "contain";
  category: NewsCategory | EventCategory;
  onImage: (url: string | null) => void;
  onFit: (fit: "cover" | "contain") => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File | Blob | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const asFile = file instanceof File ? file : new File([file], "omslag", { type: file.type });
      const blob = await downscale(asFile);
      const fd = new FormData();
      fd.append("file", blob, "omslag");
      fd.append("draftId", draftId);
      const res = await fetch("/api/admin/feed-inbox/cover", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Uppladdningen misslyckades.");
      onImage(data.imageUrl as string);
      toast({ title: "Omslaget uppladdat", description: "Det används när du godkänner.", variant: "success" });
    } catch (e) {
      toast({ title: "Kunde inte ladda upp", description: (e as Error).message, variant: "error" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /** En bild från urklipp eller drag: fil ⇒ uppladdning, data-URL ⇒ uppladdning, https ⇒ länk. */
  async function takeImage(dt: DataTransfer | null) {
    if (!dt) return;
    const file = Array.from(dt.files ?? []).find((f) => f.type.startsWith("image/"));
    if (file) return void upload(file);
    const html = dt.getData("text/html");
    const fromHtml = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
    // `getData` ger "" (inte null) när typen saknas — därför `||`, inte `??`.
    const src = (fromHtml || dt.getData("text/uri-list") || dt.getData("text/plain") || "").trim().split(/\r?\n/)[0];
    if (!src) return;
    if (src.startsWith("data:image/")) {
      try {
        return void upload(await (await fetch(src)).blob());
      } catch {
        toast({ title: "Kunde inte läsa bilden", variant: "error" });
        return;
      }
    }
    if (/^https?:\/\//i.test(src)) {
      onImage(src);
      toast({ title: "Bilden länkas från källan", description: "Ladda upp i stället om du vill att den ska ligga hos oss.", variant: "success" });
    }
  }

  return (
    <div
      className="space-y-2"
      onPaste={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        void takeImage(e.clipboardData);
      }}
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void takeImage(e.dataTransfer);
        }}
        className={cn("relative rounded-lg ring-2 ring-inset transition-colors", dragging ? "ring-holo-cyan" : "ring-transparent")}
      >
        <FeedCover src={imageUrl} alt="" category={category} fit={imageFit} className="h-40 rounded-lg" />
        <span
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 rounded-b-lg bg-black/60 px-2 py-1 text-center text-[11px] text-ink-muted",
            dragging && "text-holo-cyan"
          )}
        >
          {dragging ? "Släpp för att använda bilden" : "Dra hit en bild eller klistra in (Ctrl+V)"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? "Laddar upp…" : "Ladda upp egen bild"}
        </Button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
        <Select value={imageFit} onChange={(e) => onFit(e.target.value as "cover" | "contain")} aria-label="Bildens passform" className="h-8 text-xs">
          <option value="cover">Fyll rutan</option>
          <option value="contain">Visa hela (logga)</option>
        </Select>
      </div>
      <Input value={imageUrl ?? ""} onChange={(e) => onImage(e.target.value || null)} placeholder="Bild-URL (valfri)" aria-label="Bild-URL" className="text-xs" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidan                                                                */
/* ------------------------------------------------------------------ */

type Mode = "news" | "events";

export function NewsInboxClient({ initial }: { initial: InboxDocument }) {
  const [items, setItems] = useState<InboxEntry[]>(initial.items);
  const [events, setEvents] = useState<InboxEventEntry[]>(initial.events);
  const [mode, setMode] = useState<Mode>("news");
  const [tab, setTab] = useState<DraftStatus>("pending");

  const counts = useMemo(() => {
    const c = { news: { pending: 0, approved: 0, rejected: 0 }, events: { pending: 0, approved: 0, rejected: 0 } };
    for (const i of items) c.news[i.status]++;
    for (const e of events) c.events[e.status]++;
    return c;
  }, [items, events]);

  const replaceNews = (next: InboxEntry) => setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
  const replaceEvent = (next: InboxEventEntry) => setEvents((prev) => prev.map((i) => (i.id === next.id ? next : i)));

  const visibleNews = items.filter((i) => i.status === tab);
  const visibleEvents = events.filter((i) => i.status === tab);
  const empty = mode === "news" ? visibleNews.length === 0 : visibleEvents.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold text-ink">Nyhetsinkorgen</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Utkast från den dagliga rutinen (webben + butikernas nyhetsbrev). Rätta, byt bild och godkänn — först då syns posten på
          /nyheter eller /evenemang. Ett avvisat utkast kommer inte tillbaka.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-surface-border bg-surface-raised p-1">
          {(["news", "events"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-semibold transition-colors",
                mode === m ? "bg-surface-overlay text-holo-cyan shadow-card" : "text-ink-muted hover:text-ink"
              )}
            >
              {m === "news" ? "Nyheter" : "Evenemang"}
              <span className="ml-1.5 tabular-nums text-ink-muted">{counts[m].pending}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border border-surface-border bg-surface-raised p-1">
          {(["pending", "approved", "rejected"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setTab(s)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                tab === s ? "bg-surface-overlay text-holo-cyan shadow-card" : "text-ink-muted hover:text-ink"
              )}
            >
              {STATUS_LABEL[s]}
              <span className="ml-1.5 tabular-nums text-ink-muted">{counts[mode][s]}</span>
            </button>
          ))}
        </div>
      </div>

      {empty ? (
        <EmptyState
          title={tab === "pending" ? "Inget att granska" : tab === "approved" ? "Inget godkänt ännu" : "Inget avvisat"}
          description={
            tab === "pending" ? "Rutinen levererar nya utkast via nyhetsjobbet (05:10, 11:10, 17:10 UTC)." : "Beslutade utkast ligger kvar här i 60 dagar."
          }
        />
      ) : mode === "news" ? (
        <div className="space-y-4">
          {visibleNews.map((entry) =>
            entry.status === "pending" ? (
              <PendingNewsCard key={entry.id} entry={entry} onChange={replaceNews} />
            ) : (
              <DecidedCard
                key={entry.id}
                id={entry.id}
                endpoint={`/api/admin/feed-inbox/${entry.id}`}
                status={entry.status}
                title={entry.title}
                meta={`${entry.source} · ${dateFmt.format(new Date(entry.publishedAt))}`}
                badge={CATEGORY_LABEL[entry.category]}
                cover={{ src: entry.imageUrl, category: entry.category, fit: entry.imageFit }}
                decidedAt={entry.decidedAt}
                onChange={(item) => replaceNews(item as InboxEntry)}
              />
            )
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleEvents.map((entry) =>
            entry.status === "pending" ? (
              <PendingEventCard key={entry.id} entry={entry} onChange={replaceEvent} />
            ) : (
              <DecidedCard
                key={entry.id}
                id={entry.id}
                endpoint={`/api/admin/feed-inbox/events/${entry.id}`}
                status={entry.status}
                title={entry.title}
                meta={`${entry.city ?? "—"} · ${dateFmt.format(new Date(entry.startsAt))}`}
                badge={EVENT_CATEGORY_LABEL[entry.category]}
                cover={{ src: entry.imageUrl, category: entry.category, fit: entry.imageFit }}
                decidedAt={entry.decidedAt}
                onChange={(item) => replaceEvent(item as InboxEventEntry)}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Nyhet                                                                */
/* ------------------------------------------------------------------ */

function PendingNewsCard({ entry, onChange }: { entry: InboxEntry; onChange: (e: InboxEntry) => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<ApproveInput>({
    title: entry.title,
    summary: entry.summary,
    url: entry.url,
    source: entry.source,
    category: entry.category,
    publishedAt: entry.publishedAt,
    imageUrl: entry.imageUrl,
    imageFit: entry.imageFit,
    body: entry.body,
  });
  const [bodyText, setBodyText] = useState(entry.body.join("\n\n"));
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  function set<K extends keyof ApproveInput>(key: K, value: ApproveInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function approve() {
    setBusy("approve");
    try {
      const data = await post(`/api/admin/feed-inbox/${entry.id}`, {
        action: "approve",
        item: { ...form, imageUrl: form.imageUrl?.trim() ? form.imageUrl.trim() : null, body: splitParagraphs(bodyText) },
      });
      onChange(data.item as InboxEntry);
      toast({ title: "Publicerad", description: "Posten ligger nu på /nyheter.", variant: "success" });
    } catch (e) {
      toast({ title: "Kunde inte godkänna", description: (e as Error).message, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy("reject");
    try {
      onChange((await post(`/api/admin/feed-inbox/${entry.id}`, { action: "reject" })).item as InboxEntry);
    } catch (e) {
      toast({ title: "Kunde inte avvisa", description: (e as Error).message, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-4 p-4 md:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          <CoverPicker
            draftId={entry.id}
            imageUrl={form.imageUrl}
            imageFit={form.imageFit}
            category={form.category}
            onImage={(v) => set("imageUrl", v)}
            onFit={(v) => set("imageFit", v)}
          />
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            <Badge variant={entry.origin === "email" ? "info" : "default"}>{ORIGIN_LABEL[entry.origin]}</Badge>
            <span>hittad {stampFmt.format(new Date(entry.foundAt))}</span>
          </div>
          {entry.note && <p className="text-xs text-ink-muted">Rutinen: {entry.note}</p>}
        </div>

        <div className="space-y-3">
          <div>
            <Label htmlFor={`t-${entry.id}`}>Rubrik</Label>
            <Input id={`t-${entry.id}`} value={form.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div>
            <Label htmlFor={`s-${entry.id}`}>Ingress</Label>
            <Textarea id={`s-${entry.id}`} rows={3} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor={`c-${entry.id}`}>Kategori</Label>
              <Select id={`c-${entry.id}`} value={form.category} onChange={(e) => set("category", e.target.value as NewsCategory)}>
                {NEWS_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`k-${entry.id}`}>Källa</Label>
              <Input id={`k-${entry.id}`} value={form.source} onChange={(e) => set("source", e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`d-${entry.id}`}>Datum</Label>
              <Input
                id={`d-${entry.id}`}
                type="date"
                value={toDateInput(form.publishedAt)}
                onChange={(e) => e.target.value && set("publishedAt", new Date(`${e.target.value}T12:00:00Z`).toISOString())}
              />
            </div>
          </div>
          <BodyField id={entry.id} value={bodyText} onChange={setBodyText} hint="ger posten en egen sida (/nyheter/…) med källänken längst ned. Lämna tom för att länka direkt till källan." />
          <div>
            <Label htmlFor={`u-${entry.id}`}>Länk</Label>
            <Input id={`u-${entry.id}`} value={form.url} onChange={(e) => set("url", e.target.value)} />
            <a href={form.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-holo-cyan hover:underline">
              Öppna källan ↗
            </a>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" onClick={approve} disabled={busy !== null}>
              {busy === "approve" ? "Publicerar…" : bodyText.trim() ? "Godkänn och publicera med egen sida" : "Godkänn och publicera"}
            </Button>
            <Button type="button" variant="ghost" onClick={reject} disabled={busy !== null}>
              {busy === "reject" ? "Avvisar…" : "Avvisa"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BodyField({ id, value, onChange, hint }: { id: string; value: string; onChange: (v: string) => void; hint: string }) {
  return (
    <div>
      <Label htmlFor={`b-${id}`}>
        Text <span className="font-normal text-ink-muted">— {hint} Tom rad = nytt stycke, &quot;## &quot; = mellanrubrik.</span>
      </Label>
      <Textarea id={`b-${id}`} rows={Math.min(16, Math.max(5, value.split("\n").length + 1))} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Evenemang                                                            */
/* ------------------------------------------------------------------ */

function PendingEventCard({ entry, onChange }: { entry: InboxEventEntry; onChange: (e: InboxEventEntry) => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<ApproveEventInput>({
    title: entry.title,
    category: entry.category,
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    city: entry.city,
    venue: entry.venue,
    address: entry.address,
    mapUrl: entry.mapUrl,
    ticketUrl: entry.ticketUrl,
    infoUrl: entry.infoUrl,
    imageUrl: entry.imageUrl,
    imageFit: entry.imageFit,
    organizer: entry.organizer,
    summary: entry.summary,
    body: entry.body,
  });
  const [bodyText, setBodyText] = useState(entry.body.join("\n\n"));
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  function set<K extends keyof ApproveEventInput>(key: K, value: ApproveEventInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  const text = (v: string) => (v.trim() ? v : null);

  async function approve() {
    setBusy("approve");
    try {
      const data = await post(`/api/admin/feed-inbox/events/${entry.id}`, {
        action: "approve",
        item: { ...form, imageUrl: form.imageUrl?.trim() ? form.imageUrl.trim() : null, body: splitParagraphs(bodyText) },
      });
      onChange(data.item as InboxEventEntry);
      toast({ title: "Publicerat", description: "Evenemanget ligger nu på /evenemang.", variant: "success" });
    } catch (e) {
      toast({ title: "Kunde inte godkänna", description: (e as Error).message, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy("reject");
    try {
      onChange((await post(`/api/admin/feed-inbox/events/${entry.id}`, { action: "reject" })).item as InboxEventEntry);
    } catch (e) {
      toast({ title: "Kunde inte avvisa", description: (e as Error).message, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  const source = form.infoUrl ?? form.ticketUrl;

  return (
    <Card>
      <CardContent className="grid gap-4 p-4 md:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          <CoverPicker
            draftId={entry.id}
            imageUrl={form.imageUrl}
            imageFit={form.imageFit}
            category={form.category}
            onImage={(v) => set("imageUrl", v)}
            onFit={(v) => set("imageFit", v)}
          />
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            <Badge variant={entry.origin === "email" ? "info" : "default"}>{ORIGIN_LABEL[entry.origin]}</Badge>
            <span>hittat {stampFmt.format(new Date(entry.foundAt))}</span>
          </div>
          {entry.note && <p className="text-xs text-ink-muted">Rutinen: {entry.note}</p>}
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <div>
              <Label htmlFor={`t-${entry.id}`}>Rubrik</Label>
              <Input id={`t-${entry.id}`} value={form.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`c-${entry.id}`}>Sort</Label>
              <Select id={`c-${entry.id}`} value={form.category} onChange={(e) => set("category", e.target.value as EventCategory)}>
                {EVENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {EVENT_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor={`s-${entry.id}`}>Ingress</Label>
            <Textarea id={`s-${entry.id}`} rows={2} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`st-${entry.id}`}>Börjar (svensk tid)</Label>
              <Input id={`st-${entry.id}`} type="datetime-local" value={toLocalInput(form.startsAt)} onChange={(e) => e.target.value && set("startsAt", fromLocalInput(e.target.value)!)} />
            </div>
            <div>
              <Label htmlFor={`en-${entry.id}`}>Slutar</Label>
              <Input id={`en-${entry.id}`} type="datetime-local" value={toLocalInput(form.endsAt)} onChange={(e) => set("endsAt", fromLocalInput(e.target.value))} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor={`ci-${entry.id}`}>Stad</Label>
              <Input id={`ci-${entry.id}`} value={form.city ?? ""} onChange={(e) => set("city", text(e.target.value))} />
            </div>
            <div>
              <Label htmlFor={`ve-${entry.id}`}>Plats</Label>
              <Input id={`ve-${entry.id}`} value={form.venue ?? ""} onChange={(e) => set("venue", text(e.target.value))} />
            </div>
            <div>
              <Label htmlFor={`or-${entry.id}`}>Arrangör</Label>
              <Input id={`or-${entry.id}`} value={form.organizer ?? ""} onChange={(e) => set("organizer", text(e.target.value))} />
            </div>
          </div>
          <div>
            <Label htmlFor={`ad-${entry.id}`}>Adress</Label>
            <Input id={`ad-${entry.id}`} value={form.address ?? ""} onChange={(e) => set("address", text(e.target.value))} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor={`tu-${entry.id}`}>Biljettlänk</Label>
              <Input id={`tu-${entry.id}`} value={form.ticketUrl ?? ""} onChange={(e) => set("ticketUrl", text(e.target.value))} placeholder="https://" />
            </div>
            <div>
              <Label htmlFor={`iu-${entry.id}`}>Infolänk</Label>
              <Input id={`iu-${entry.id}`} value={form.infoUrl ?? ""} onChange={(e) => set("infoUrl", text(e.target.value))} placeholder="https://" />
            </div>
            <div>
              <Label htmlFor={`mu-${entry.id}`}>Kartlänk</Label>
              <Input id={`mu-${entry.id}`} value={form.mapUrl ?? ""} onChange={(e) => set("mapUrl", text(e.target.value))} placeholder="https://" />
            </div>
          </div>
          {source && (
            <a href={source} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-holo-cyan hover:underline">
              Öppna arrangörens sida ↗
            </a>
          )}
          <BodyField id={entry.id} value={bodyText} onChange={setBodyText} hint="visas på evenemangets sida (öppettider, bra att veta)." />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" onClick={approve} disabled={busy !== null}>
              {busy === "approve" ? "Publicerar…" : "Godkänn och publicera"}
            </Button>
            <Button type="button" variant="ghost" onClick={reject} disabled={busy !== null}>
              {busy === "reject" ? "Avvisar…" : "Avvisa"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Avgjord rad — samma kort för båda sorterna                           */
/* ------------------------------------------------------------------ */

function DecidedCard({
  id,
  endpoint,
  status,
  title,
  meta,
  badge,
  cover,
  decidedAt,
  onChange,
}: {
  id: string;
  endpoint: string;
  status: DraftStatus;
  title: string;
  meta: string;
  badge: string;
  cover: { src: string | null; category: NewsCategory | EventCategory; fit: "cover" | "contain" };
  decidedAt: string | null;
  onChange: (item: InboxEntry | InboxEventEntry) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const approved = status === "approved";

  async function act(action: "unpublish" | "restore") {
    setBusy(true);
    try {
      onChange((await post(endpoint, { action })).item);
      toast({
        title: action === "unpublish" ? "Borttagen ur flödet" : "Tillbaka i inkorgen",
        description: "Utkastet ligger under Väntar igen.",
        variant: "success",
      });
    } catch (e) {
      toast({ title: "Något gick fel", description: (e as Error).message, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card key={id}>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <FeedCover src={cover.src} alt="" category={cover.category} fit={cover.fit} className="h-14 w-24 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={approved ? "success" : "default"}>{approved ? "Publicerad" : "Avvisad"}</Badge>
            <Badge>{badge}</Badge>
            <span className="text-xs text-ink-muted">
              {meta}
              {decidedAt && ` · beslut ${stampFmt.format(new Date(decidedAt))}`}
            </span>
          </div>
          <p className="mt-1 truncate font-medium text-ink">{title}</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => act(approved ? "unpublish" : "restore")}>
          {approved ? "Ta bort ur flödet" : "Återställ"}
        </Button>
      </CardContent>
    </Card>
  );
}
