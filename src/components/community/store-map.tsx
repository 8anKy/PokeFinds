"use client";
/* eslint-disable @next/next/no-img-element */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { IconPlus, IconMapPin, IconChevronRight } from "@/components/ui/icons";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Input } from "@/components/ui/input";
import { hasStorePosition, storesInBounds, storesForBrowsing, type MapBounds, type MapPoint } from "@/lib/community-map";
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
  const [browseOpen, setBrowseOpen] = useState(false);
  const [detailStore, setDetailStore] = useState<CommunityStoreDto | null>(null);
  useEffect(() => {
    if (!initialStoreId) return;
    const store = stores.find(s => s.id === initialStoreId);
    if (store) { setSelected(store.id); if (hasStorePosition(store)) setFocus({ latitude: store.latitude, longitude: store.longitude, zoom: 15 }); }
  }, [initialStoreId, stores]);
  const matching = useMemo(() => stores.filter(s => (!onlyFollowed || followed?.includes(s.id)) && `${s.name} ${s.address} ${s.city}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [stores, search, onlyFollowed, followed]);
  const mapped = useMemo(() => matching.filter(hasStorePosition), [matching]);
  const visible = useMemo(() => bounds ? storesInBounds(matching, bounds, position ?? center) : mapped, [matching, bounds, position, center, mapped]);
  const browseList = useMemo(() => storesForBrowsing(matching, position), [matching, position]);
  // Sökresultat får aldrig försvinna för att kartan visar en annan ort.
  const list = search.trim() ? browseList : visible;
  const view = useCallback((b: MapBounds, c: MapPoint) => { setBounds(b); setCenter(c); }, []);
  function locate() {
    if (!navigator.geolocation) { setError(t("mapLocationUnavailable")); return; }
    setLocating(true); setError("");
    navigator.geolocation.getCurrentPosition(p => {
      const point = { latitude: p.coords.latitude, longitude: p.coords.longitude };
      setPosition(point); setFocus(point); setSelected(""); setSearch(""); setLocating(false);
    }, () => { setLocating(false); setError(t("mapLocationUnavailable")); }, { maximumAge: 60000, timeout: 10000 });
  }
  function openStore(store: CommunityStoreDto) { setSelected(store.id); setDetailStore(store); }
  const storeRow = (store: CommunityStoreDto) => <li key={store.id} data-store-id={store.id}>
    <button type="button" onClick={() => openStore(store)} aria-current={store.id === selected ? "true" : undefined}
      className={`flex min-h-[76px] w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-surface-overlay ${store.id === selected ? "bg-holo-cyan/5 ring-1 ring-inset ring-holo-cyan/30" : "hover:bg-surface-overlay/50"}`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-surface-border bg-surface text-xs font-semibold text-holo-cyan">{store.logoUrl ? <img src={store.logoUrl} alt="" className="h-full w-full object-contain" loading="lazy" /> : store.name.slice(0, 2).toUpperCase()}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{store.name}</span><span className="mt-1 block truncate text-xs text-ink-muted">{store.address} · {store.city}</span>{!hasStorePosition(store) && <span className="block text-xs text-ink-faint">{t("positionPending")}</span>}</span>
      <span className="flex shrink-0 items-center gap-2 text-ink-muted">{position && hasStorePosition(store) && <span className="text-xs tabular-nums">{(distanceMeters(store, position) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km</span>}<IconChevronRight size={18} /></span>
    </button>
  </li>;
  const empty = <li className="space-y-3 py-5 text-center"><p className="text-sm text-ink-muted">{t(search ? "noStoreMatches" : "noStoresInView")}</p><Button variant="secondary" size="sm" onClick={() => { setSearch(""); setFocus({ latitude: 62, longitude: 15, zoom: 5 }); }}>{t("showSweden")}</Button></li>;
  return <>
    <div data-store-map-view className="flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_var(--bottom-tabs-space)_-_8.5rem)] min-h-[320px] flex-col overflow-hidden rounded-2xl border border-surface-border sm:h-[680px]">
      <div className="relative isolate h-[34dvh] min-h-[200px] shrink-0 sm:h-[360px]">
        <Canvas stores={mapped} selectedId={selected} focus={focus} userPosition={position} onSelect={id => { const store = stores.find(s => s.id === id); if (store) openStore(store); setChoosingPin(false); }} onView={view} onPin={choosingPin ? point => { setChoosingPin(false); onSuggest(point); } : undefined} />
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] space-y-2" data-swipe-ignore>
          <Input className="pointer-events-auto h-11 w-full rounded-xl border-surface-border bg-surface/95 shadow-lg" id="community-area" aria-label={t("searchStores")} placeholder={t("searchStores")} value={search} onChange={e => { setSearch(e.target.value); setError(""); }} maxLength={100} />
          <div className="flex items-center gap-1.5"><div className="pointer-events-auto flex rounded-full border border-surface-border bg-surface/95 p-1 shadow-lg"><button type="button" onClick={() => { if (onlyFollowed) onFollowed(); }} className={`min-h-8 rounded-full px-3 text-xs ${!onlyFollowed ? "bg-holo-cyan text-surface" : "text-ink-muted"}`} aria-pressed={!onlyFollowed}>{t("all")}</button><button type="button" disabled={busy} onClick={() => { if (!onlyFollowed) onFollowed(); }} className={`min-h-8 rounded-full px-3 text-xs ${onlyFollowed ? "bg-holo-cyan text-surface" : "text-ink-muted"}`} aria-pressed={onlyFollowed}>{t("followed")}</button></div>
            <button type="button" className="pointer-events-auto ml-auto grid h-10 w-10 place-items-center rounded-full border border-surface-border bg-surface/95 text-ink shadow-lg" aria-label={t(choosingPin ? "cancelPin" : "suggestStore")} onClick={() => setChoosingPin(v => !v)}><IconPlus size={18} className={choosingPin ? "rotate-45" : ""} /></button>
          </div>
          {choosingPin && <p className="pointer-events-auto rounded-xl border border-holo-cyan/30 bg-surface/95 p-3 text-xs text-ink" role="status">{t("choosePin")} <button type="button" className="text-holo-cyan underline" onClick={() => { setChoosingPin(false); onSuggest(); }}>{t("withoutPin")}</button></p>}
          {error && <p className="rounded-xl bg-surface/95 p-3 text-xs text-ink" role="status">{error}</p>}
        </div>
        <button type="button" aria-label={t(locating ? "locating" : "myLocation")} disabled={locating} onClick={locate} className="absolute bottom-7 left-3 z-[500] grid h-10 w-10 place-items-center rounded-full border border-surface-border bg-surface/95 text-holo-cyan shadow-lg"><IconMapPin size={20} className={locating ? "animate-pulse" : ""} /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col bg-surface px-2 pt-1">
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 px-1"><h2 className="text-sm font-semibold text-ink">{t(search ? "searchResults" : "storesInView")} <span className="ml-1 font-normal tabular-nums text-ink-muted">{list.length}</span></h2><button type="button" onClick={() => setBrowseOpen(true)} className="min-h-11 text-xs font-medium text-holo-cyan">{t("browseStores")}</button></div>
        <ul data-store-list className="min-h-0 flex-1 divide-y divide-surface-border overflow-y-auto overscroll-contain pb-3">{list.length ? list.map(storeRow) : empty}</ul>
      </div>
    </div>
    <BottomSheet open={browseOpen} title={t("storeList")} closeLabel={t("close")} onClose={() => setBrowseOpen(false)} headerAction={{ label: t("close"), onClick: () => setBrowseOpen(false) }} panelClassName="h-[90dvh] max-h-[calc(100%_-_env(safe-area-inset-top)_-_0.5rem)] sm:mx-auto sm:w-full sm:max-w-xl">
      <div className="sticky top-0 z-10 space-y-2 bg-surface pb-3">
        <Input id="community-store-search" aria-label={t("searchStores")} placeholder={t("searchStores")} value={search} onChange={e => setSearch(e.target.value)} maxLength={100} />
        <div className="flex items-center justify-between gap-2 text-xs text-ink-muted"><span>{t("storeCount", { count: browseList.length })} · {t(position ? "nearestFirst" : "byCity")}</span>{search && <button type="button" onClick={() => setSearch("")} className="min-h-9 text-holo-cyan">{t("clearSearch")}</button>}</div>
      </div>
      <ul data-store-browser className="divide-y divide-surface-border pb-6">{browseList.length ? browseList.map(storeRow) : empty}</ul>
    </BottomSheet>
    <BottomSheet open={!!detailStore} title={detailStore?.name ?? t("store")} closeLabel={t("close")} onClose={() => setDetailStore(null)} headerAction={{ label: t("close"), onClick: () => setDetailStore(null) }} panelClassName="sm:mx-auto sm:w-full sm:max-w-xl">
      {detailStore && <div className="space-y-4 pb-6">
        <p className="text-sm text-ink-muted">{detailStore.address} · {detailStore.city}</p>
        {detailStore.assortmentUnconfirmed && <p className="text-xs text-ink-faint">{t("assortmentUnconfirmed")}</p>}
        <div className="grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => { setDetailStore(null); onReports(detailStore); }}>{t("storeReports")}</Button><Button onClick={() => { setDetailStore(null); onReport(detailStore); }}>{t("addReport")}</Button></div>
        <div className="divide-y divide-surface-border">
          {hasStorePosition(detailStore) && <button type="button" className="flex min-h-12 w-full items-center justify-between text-sm text-ink" onClick={() => { setFocus({ latitude: detailStore.latitude!, longitude: detailStore.longitude!, zoom: 15 }); setBrowseOpen(false); setDetailStore(null); }}>{t("showOnMap")}<IconMapPin size={18} /></button>}
          <a className="flex min-h-12 items-center justify-between text-sm text-ink" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${detailStore.address}, ${detailStore.city}, Sweden`)}`} target="_blank" rel="noopener noreferrer">{t("directions")}<IconChevronRight size={18} /></a>
          <button type="button" className="flex min-h-12 w-full items-center justify-between text-sm text-ink" disabled={busy} aria-pressed={followed?.includes(detailStore.id) ?? false} onClick={() => onFollow(detailStore.id)}>{t(followed?.includes(detailStore.id) ? "following" : "follow")}<IconChevronRight size={18} /></button>
          {detailStore.websiteUrl && <a className="flex min-h-12 items-center justify-between text-sm text-ink" href={detailStore.websiteUrl} target="_blank" rel="noopener noreferrer">{t("website")}<IconChevronRight size={18} /></a>}
        </div>
      </div>}
    </BottomSheet>
  </>;
}
