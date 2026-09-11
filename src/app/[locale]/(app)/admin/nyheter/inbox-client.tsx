"use client";

/**
 * Nyhetsinkorgen i admin. Tre listor: väntar / godkända / avvisade. Ett väntande
 * utkast redigeras direkt i kortet och godkänns med de rättade fälten — det finns
 * inget "spara utkast", för godkännandet ÄR sparandet (och rutinen skriver aldrig
 * över en rad den redan levererat, se `mergeInbox`).
 *
 * Omslaget: rutinens förslag ligger i `imageUrl`; ägaren kan klistra in en annan
 * URL eller ladda upp en egen bild, som skalas ned i webbläsaren (≤ 1600 px, JPEG)
 * innan den skickas — samma grepp som forumets bildväljare, av samma skäl (storlek
 * och EXIF).
 */
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { FeedCover } from "@/components/features/feed/feed-chrome";
import { NEWS_CATEGORIES, type NewsCategory } from "@/lib/feed";
import type { ApproveInput, DraftStatus, InboxDocument, InboxEntry } from "@/lib/feed-inbox";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<NewsCategory, string> = {
  RELEASE: "Släpp",
  MARKET: "Marknad",
  STORE: "Butik",
  APP: "Foilio",
};

const ORIGIN_LABEL = { email: "Nyhetsbrev", web: "Webben" } as const;

const dateFmt = new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" });
const stampFmt = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" });

function toDateInput(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
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

export function NewsInboxClient({ initial }: { initial: InboxDocument }) {
  const [items, setItems] = useState<InboxEntry[]>(initial.items);
  const [tab, setTab] = useState<DraftStatus>("pending");

  const counts = useMemo(() => {
    const c: Record<DraftStatus, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const i of items) c[i.status]++;
    return c;
  }, [items]);

  const visible = items.filter((i) => i.status === tab);

  function replace(next: InboxEntry) {
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold text-ink">Nyhetsinkorgen</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Utkast från den dagliga rutinen (webben + butikernas nyhetsbrev). Rätta, byt bild och godkänn — först då
          syns posten på /nyheter. Ett avvisat utkast kommer inte tillbaka.
        </p>
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
            {s === "pending" ? "Väntar" : s === "approved" ? "Godkända" : "Avvisade"}
            <span className="ml-1.5 tabular-nums text-ink-muted">{counts[s]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={tab === "pending" ? "Inget att granska" : tab === "approved" ? "Inget godkänt ännu" : "Inget avvisat"}
          description={
            tab === "pending"
              ? "Rutinen levererar nya utkast via nyhetsjobbet (05:10, 11:10, 17:10 UTC)."
              : "Beslutade utkast ligger kvar här i 60 dagar."
          }
        />
      ) : (
        <div className="space-y-4">
          {visible.map((entry) =>
            entry.status === "pending" ? (
              <PendingCard key={entry.id} entry={entry} onChange={replace} />
            ) : (
              <DecidedCard key={entry.id} entry={entry} onChange={replace} />
            )
          )}
        </div>
      )}
    </div>
  );
}

async function decide(id: string, body: unknown): Promise<InboxEntry> {
  const res = await fetch(`/api/admin/feed-inbox/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? "Något gick fel.");
  return data.item as InboxEntry;
}

function PendingCard({ entry, onChange }: { entry: InboxEntry; onChange: (e: InboxEntry) => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<ApproveInput>({
    title: entry.title,
    summary: entry.summary,
    url: entry.url,
    source: entry.source,
    category: entry.category,
    publishedAt: entry.publishedAt,
    imageUrl: entry.imageUrl,
    imageFit: entry.imageFit,
  });
  const [busy, setBusy] = useState<"approve" | "reject" | "upload" | null>(null);

  function set<K extends keyof ApproveInput>(key: K, value: ApproveInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy("upload");
    try {
      const blob = await downscale(file);
      const fd = new FormData();
      fd.append("file", blob, "omslag");
      fd.append("draftId", entry.id);
      const res = await fetch("/api/admin/feed-inbox/cover", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Uppladdningen misslyckades.");
      set("imageUrl", data.imageUrl as string);
      toast({ title: "Omslaget uppladdat", description: "Det används när du godkänner.", variant: "success" });
    } catch (e) {
      toast({ title: "Kunde inte ladda upp", description: (e as Error).message, variant: "error" });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function approve() {
    setBusy("approve");
    try {
      const next = await decide(entry.id, {
        action: "approve",
        item: { ...form, imageUrl: form.imageUrl?.trim() ? form.imageUrl.trim() : null },
      });
      onChange(next);
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
      onChange(await decide(entry.id, { action: "reject" }));
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
          <FeedCover src={form.imageUrl} alt="" category={form.category} fit={form.imageFit} className="h-40 rounded-lg" />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
            >
              {busy === "upload" ? "Laddar upp…" : "Ladda upp egen bild"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
            <Select
              value={form.imageFit}
              onChange={(e) => set("imageFit", e.target.value as "cover" | "contain")}
              aria-label="Bildens passform"
              className="h-8 text-xs"
            >
              <option value="cover">Fyll rutan</option>
              <option value="contain">Visa hela (logga)</option>
            </Select>
          </div>
          <Input
            value={form.imageUrl ?? ""}
            onChange={(e) => set("imageUrl", e.target.value || null)}
            placeholder="Bild-URL (valfri)"
            aria-label="Bild-URL"
            className="text-xs"
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
          <div>
            <Label htmlFor={`u-${entry.id}`}>Länk</Label>
            <Input id={`u-${entry.id}`} value={form.url} onChange={(e) => set("url", e.target.value)} />
            <a href={form.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-holo-cyan hover:underline">
              Öppna källan ↗
            </a>
          </div>
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

function DecidedCard({ entry, onChange }: { entry: InboxEntry; onChange: (e: InboxEntry) => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const approved = entry.status === "approved";

  async function act(action: "unpublish" | "restore") {
    setBusy(true);
    try {
      onChange(await decide(entry.id, { action }));
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
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <FeedCover src={entry.imageUrl} alt="" category={entry.category} fit={entry.imageFit} className="h-14 w-24 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={approved ? "success" : "default"}>{approved ? "Publicerad" : "Avvisad"}</Badge>
            <Badge>{CATEGORY_LABEL[entry.category]}</Badge>
            <span className="text-xs text-ink-muted">
              {entry.source} · {dateFmt.format(new Date(entry.publishedAt))}
              {entry.decidedAt && ` · beslut ${stampFmt.format(new Date(entry.decidedAt))}`}
            </span>
          </div>
          <p className="mt-1 truncate font-medium text-ink">{entry.title}</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => act(approved ? "unpublish" : "restore")}>
          {approved ? "Ta bort ur flödet" : "Återställ"}
        </Button>
      </CardContent>
    </Card>
  );
}
