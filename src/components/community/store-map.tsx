"use client";
/* eslint-disable @next/next/no-img-element */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hasStorePosition, storesInBounds, type MapBounds, type MapPoint } from "@/lib/community-map";
import { distanceMeters } from "@/lib/community-stores";
import type { CommunityStoreDto } from "@/services/community-stores";

const Canvas = dynamic(() => import("./store-map-canvas"), { ssr: false, loading: () => <div className="h-[45dvh] min-h-[300px] animate-pulse rounded-2xl border border-surface-border sm:h-[480px]" /> });

export function StoreMap({ stores, onReport, onReports, onSuggest, onFollow, followed, busy, onlyFollowed, onFollowed }: {
  stores: CommunityStoreDto[]; onReport: (s: CommunityStoreDto) => void; onReports: (s: CommunityStoreDto) => void;
  onSuggest: (point?: MapPoint) => void; onFollow: (id: string) => void; followed: string[] | null;
  busy: boolean; onlyFollowed: boolean; onFollowed: () => void;
}) {
  const t = useTranslations("LocalStores");
  const [search, setSearch] = useState("");
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [center, setCenter] = useState<MapPoint>({ latitude: 62, longitude: 15 });
  const [focus, setFocus] = useState<(MapPoint & { zoom?: number }) | null>(null);
  const [position, setPosition] = useState<MapPoint | null>(null);
  const [selected, setSelected] = useState("");
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [choosingPin, setChoosingPin] = useState(false);
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
  const renderStore = (store: CommunityStoreDto) => <li key={store.id} className={`space-y-3 py-4 ${store.id === selected ? "rounded-xl bg-holo-cyan/5 px-3 ring-1 ring-inset ring-holo-cyan/30" : ""}`}>
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => { setSelected(store.id); if (hasStorePosition(store)) setFocus({ latitude: store.latitude, longitude: store.longitude }); }}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-surface-border bg-surface text-sm font-semibold text-holo-cyan">{store.logoUrl ? <img src={store.logoUrl} alt="" className="h-full w-full rounded-xl object-contain" loading="lazy" /> : store.name.slice(0, 2).toUpperCase()}</span>
        <span className="min-w-0 flex-1"><span className="block font-medium text-ink">{store.name}</span><span className="block text-xs text-ink-muted">{store.address} · {store.city}</span>{!hasStorePosition(store) && <span className="text-xs text-ink-faint">{t("positionPending")}</span>}</span>
        {position && hasStorePosition(store) && <span className="shrink-0 text-xs text-ink-muted">{(distanceMeters(store, position) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km</span>}
      </button>
      {store.assortmentUnconfirmed && <p className="text-xs text-ink-faint">{t("assortmentUnconfirmed")}</p>}
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" onClick={() => onReport(store)}>{t("report")}</Button><Button variant="secondary" size="sm" onClick={() => onReports(store)}>{t("storeReports")}</Button><button type="button" className="min-h-10 px-2 text-sm text-holo-cyan" disabled={busy} aria-pressed={followed?.includes(store.id) ?? false} onClick={() => onFollow(store.id)}>{t(followed?.includes(store.id) ? "following" : "follow")}</button><a className="inline-flex min-h-10 items-center text-sm text-ink-muted" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${store.address}, ${store.city}, Sweden`)}`} target="_blank" rel="noopener noreferrer">{t("directions")}</a>{store.websiteUrl && <a className="inline-flex min-h-10 items-center text-sm text-ink-muted" href={store.websiteUrl} target="_blank" rel="noopener noreferrer">{t("website")}</a>}</div>
    </li>;
  return <div className="space-y-3">
    <div className="flex items-center gap-2"><Input className="min-w-0 flex-1" id="community-area" aria-label={t("searchStores")} placeholder={t("searchStores")} value={search} onChange={e => { setSearch(e.target.value); setSelected(""); }} maxLength={100} /><Button className="shrink-0 whitespace-nowrap" variant="secondary" disabled={locating} onClick={locate}>{t(locating ? "locating" : "myLocation")}</Button></div>
    <div className="flex items-center justify-between gap-2"><Button variant={onlyFollowed ? "primary" : "secondary"} size="sm" disabled={busy} onClick={onFollowed}>{t(onlyFollowed ? "allStores" : "followedStores")}</Button><Button variant="ghost" size="sm" onClick={() => setChoosingPin(v => !v)}>{t(choosingPin ? "cancelPin" : "suggestStore")}</Button></div>
    {choosingPin && <p className="rounded-lg border border-holo-cyan/30 p-3 text-sm text-holo-cyan" role="status">{t("choosePin")} <button type="button" className="underline" onClick={() => { setChoosingPin(false); onSuggest(); }}>{t("withoutPin")}</button></p>}
    {error && <p className="text-sm text-ink-muted" role="status">{error}</p>}
    <Canvas stores={mapped} selectedId={selected} focus={focus} userPosition={position} onSelect={id => { setSelected(id); setChoosingPin(false); }} onView={view} onPin={choosingPin ? point => { setChoosingPin(false); onSuggest(point); } : undefined} />
    <div className="flex items-baseline justify-between gap-3 pt-2"><h2 className="font-display text-lg font-semibold text-ink">{t("storesInView")}</h2><span className="text-xs tabular-nums text-ink-muted">{t("storeCount", { count: visible.length })}</span></div>
    <p className="text-xs text-ink-muted">{t("mapHint")}</p>
    {!list.length && <div className="space-y-3 py-6 text-center"><p className="text-sm text-ink-muted">{t(search ? "noStoreMatches" : "noStoresInView")}</p><Button variant="secondary" onClick={() => { setSearch(""); setFocus({ latitude: 62, longitude: 15, zoom: 5 }); }}>{t("showSweden")}</Button></div>}
    <ul className="divide-y divide-surface-border">{list.slice(0, 50).map(renderStore)}</ul>
    {matching.some(s => !hasStorePosition(s)) && <details className="border-t border-surface-border pt-3"><summary className="cursor-pointer text-sm text-ink-muted">{t("unmappedStores", { count: matching.filter(s => !hasStorePosition(s)).length })}</summary><ul className="divide-y divide-surface-border">{matching.filter(s => !hasStorePosition(s)).map(renderStore)}</ul></details>}

  </div>;
}
