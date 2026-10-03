"use client";
/* eslint-disable @next/next/no-img-element */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { IconPlus, IconMapPin } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { hasStorePosition, storesInBounds, type MapBounds, type MapPoint } from "@/lib/community-map";
import { distanceMeters } from "@/lib/community-stores";
import type { CommunityStoreDto } from "@/services/community-stores";

const Canvas = dynamic(() => import("./store-map-canvas"), { ssr: false, loading: () => <div className="h-full animate-pulse bg-surface-overlay" /> });

export function StoreMap({ stores, onReport, onReports, onSuggest, onFollow, followed, busy, onlyFollowed, onFollowed, initialStoreId }: {
  initialStoreId?: string; stores: CommunityStoreDto[]; onReport: (s: CommunityStoreDto) => void; onReports: (s: CommunityStoreDto) => void;
  onSuggest: (point?: MapPoint) => void; onFollow: (id: string) => void; followed: string[] | null;
  busy: boolean; onlyFollowed: boolean; onFollowed: () => void;
}) {
  const t = useTranslations("LocalStores");
  const [search, setSearch] = useState("");
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [center, setCenter] = useState<MapPoint>({ latitude: 62, longitude: 15 });
  const [focus, setFocus] = useState<(MapPoint & { zoom?: number }) | null>(null);
  const [position, setPosition] = useState<MapPoint | null>(null);
  const [selected, setSelected] = useState(initialStoreId ?? "");
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [choosingPin, setChoosingPin] = useState(false);
  useEffect(() => {
    if (!initialStoreId) return;
    const store = stores.find(s => s.id === initialStoreId);
    if (store) { setSelected(store.id); if (hasStorePosition(store)) setFocus({ latitude: store.latitude, longitude: store.longitude, zoom: 15 }); }
  }, [initialStoreId, stores]);
  const storeList = useRef<HTMLUListElement>(null);
  useEffect(() => { if (selected) storeList.current?.scrollTo({ top: 0 }); }, [selected]);
  const matching = useMemo(() => stores.filter(s => (!onlyFollowed || followed?.includes(s.id)) && `${s.name} ${s.address} ${s.city}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [stores, search, onlyFollowed, followed]);
  const mapped = useMemo(() => matching.filter(hasStorePosition), [matching]);
  const visible = useMemo(() => bounds ? storesInBounds(matching, bounds, position ?? center) : mapped, [matching, bounds, position, center, mapped]);
  const selectedStore = matching.find(s => s.id === selected);
  const list = selectedStore ? [selectedStore, ...visible.filter(s => s.id !== selected)] : visible;
  const view = useCallback((b: MapBounds, c: MapPoint) => { setBounds(b); setCenter(c); }, []);
  useEffect(() => {
    if (search.trim() && mapped.length) {
      const first = mapped[0]; setFocus({ latitude: first.latitude, longitude: first.longitude, zoom: mapped.length === 1 ? 15 : 12 });
    }
  }, [search, mapped]);
  function locate() {
    if (!navigator.geolocation) { setError(t("mapLocationUnavailable")); return; }
    setLocating(true); setError("");
    navigator.geolocation.getCurrentPosition(p => {
      const point = { latitude: p.coords.latitude, longitude: p.coords.longitude };
      setPosition(point); setFocus(point); setSelected(""); setSearch(""); setLocating(false);
    }, () => { setLocating(false); setError(t("mapLocationUnavailable")); }, { maximumAge: 60000, timeout: 10000 });
  }
  const renderStore = (store: CommunityStoreDto) => <li key={store.id} data-store-id={store.id} className={`rounded-xl border p-3 ${store.id === selected ? "border-holo-cyan/40 bg-holo-cyan/5 ring-1 ring-inset ring-holo-cyan/20" : "border-surface-border bg-surface"}`}>
    <button type="button" aria-expanded={store.id === selected} className="flex w-full items-center gap-3 text-left" onClick={() => { setSelected(store.id === selected ? "" : store.id); if (hasStorePosition(store)) setFocus({ latitude: store.latitude, longitude: store.longitude }); }}>
      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-surface-border bg-surface text-xs font-semibold text-holo-cyan">{store.logoUrl ? <img src={store.logoUrl} alt="" className="h-full w-full object-contain" loading="lazy" /> : store.name.slice(0, 2).toUpperCase()}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink">{store.name}</span><span className="block truncate text-xs text-ink-muted">{store.city}{!hasStorePosition(store) && ` · ${t("positionPending")}`}</span></span>
      {position && hasStorePosition(store) && <span className="shrink-0 text-xs text-ink-muted">{(distanceMeters(store, position) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km</span>}
    </button>
    {store.id === selected && <div className="mt-3 space-y-2 border-t border-surface-border pt-3">
      <p className="text-xs text-ink-muted">{store.address} · {store.city}</p>
      {store.assortmentUnconfirmed && <p className="text-xs text-ink-faint">{t("assortmentUnconfirmed")}</p>}
      <div className="flex flex-wrap items-center gap-x-4"><button type="button" onClick={() => onReport(store)} className="inline-flex min-h-10 items-center gap-1.5 text-sm text-holo-cyan"><IconPlus size={16} />{t("addReport")}</button><button type="button" className="min-h-10 text-xs text-ink-muted" disabled={busy} aria-pressed={followed?.includes(store.id) ?? false} onClick={() => onFollow(store.id)}>{t(followed?.includes(store.id) ? "following" : "follow")}</button>{store.websiteUrl && <a className="inline-flex min-h-10 items-center text-xs text-ink-muted" href={store.websiteUrl} target="_blank" rel="noopener noreferrer">{t("website")}</a>}</div>
    </div>}
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button type="button" className="min-h-9 rounded-lg bg-holo-cyan/10 px-2 text-xs font-medium text-holo-cyan" onClick={() => onReports(store)}>{t("storeReports")}</button>
      <a className="flex min-h-9 items-center justify-center rounded-lg bg-surface-overlay px-2 text-xs text-ink-muted" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${store.address}, ${store.city}, Sweden`)}`} target="_blank" rel="noopener noreferrer">{t("directions")}</a>
    </div>
  </li>;
  return <div data-store-map-view className="flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_var(--bottom-tabs-space)_-_8.5rem)] min-h-[320px] flex-col overflow-hidden rounded-2xl border border-surface-border sm:h-[680px]">
    <div className="relative isolate h-[34dvh] min-h-[200px] shrink-0 sm:h-[360px]">
      <Canvas stores={mapped} selectedId={selected} focus={focus} userPosition={position} onSelect={id => { setSelected(id); setChoosingPin(false); }} onView={view} onPin={choosingPin ? point => { setChoosingPin(false); onSuggest(point); } : undefined} />
      <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] space-y-2" data-swipe-ignore>
        <Input className="pointer-events-auto h-11 w-full rounded-xl border-surface-border bg-surface/95 shadow-lg" id="community-area" aria-label={t("searchStores")} placeholder={t("searchStores")} value={search} onChange={e => { setSearch(e.target.value); setSelected(""); setError(""); }} maxLength={100} />
        <div className="flex items-center gap-1.5"><div className="pointer-events-auto flex rounded-full border border-surface-border bg-surface/95 p-1 shadow-lg"><button type="button" onClick={() => { if (onlyFollowed) onFollowed(); }} className={`min-h-8 rounded-full px-3 text-xs ${!onlyFollowed ? "bg-holo-cyan text-surface" : "text-ink-muted"}`} aria-pressed={!onlyFollowed}>{t("all")}</button><button type="button" disabled={busy} onClick={() => { if (!onlyFollowed) onFollowed(); }} className={`min-h-8 rounded-full px-3 text-xs ${onlyFollowed ? "bg-holo-cyan text-surface" : "text-ink-muted"}`} aria-pressed={onlyFollowed}>{t("followed")}</button></div>
          <button type="button" className="pointer-events-auto ml-auto grid h-10 w-10 place-items-center rounded-full border border-surface-border bg-surface/95 text-ink shadow-lg" aria-label={t(choosingPin ? "cancelPin" : "suggestStore")} onClick={() => setChoosingPin(v => !v)}><IconPlus size={18} className={choosingPin ? "rotate-45" : ""} /></button>
        </div>
        {choosingPin && <p className="pointer-events-auto rounded-xl border border-holo-cyan/30 bg-surface/95 p-3 text-xs text-ink" role="status">{t("choosePin")} <button type="button" className="text-holo-cyan underline" onClick={() => { setChoosingPin(false); onSuggest(); }}>{t("withoutPin")}</button></p>}
        {error && <p className="rounded-xl bg-surface/95 p-3 text-xs text-ink" role="status">{error}</p>}
      </div>
      <button type="button" aria-label={t(locating ? "locating" : "myLocation")} disabled={locating} onClick={locate} className="absolute bottom-7 left-3 z-[500] grid h-10 w-10 place-items-center rounded-full border border-surface-border bg-surface/95 text-holo-cyan shadow-lg"><IconMapPin size={20} className={locating ? "animate-pulse" : ""} /></button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col bg-surface px-3 pt-3">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2"><h2 className="text-sm font-semibold text-ink">{t("storesInView")}</h2><span className="text-xs tabular-nums text-ink-muted">{t("storeCount", { count: visible.length })}</span></div>
      <ul ref={storeList} data-store-list className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-3">
        {!list.length && <li className="space-y-3 py-5 text-center"><p className="text-sm text-ink-muted">{t(search ? "noStoreMatches" : "noStoresInView")}</p><Button variant="secondary" size="sm" onClick={() => { setSearch(""); setFocus({ latitude: 62, longitude: 15, zoom: 5 }); }}>{t("showSweden")}</Button></li>}
        {list.slice(0, 50).map(renderStore)}
        {matching.some(s => !hasStorePosition(s)) && <li><details className="pt-2"><summary className="cursor-pointer text-xs text-ink-muted">{t("unmappedStores", { count: matching.filter(s => !hasStorePosition(s)).length })}</summary><ul className="mt-3 space-y-2">{matching.filter(s => !hasStorePosition(s)).map(renderStore)}</ul></details></li>}
      </ul>
    </div>
  </div>;
}
