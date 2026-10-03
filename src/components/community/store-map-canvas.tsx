"use client";

import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTranslations } from "next-intl";
import { hasStorePosition, storeClusters, type MapBounds, type MapPoint, type MapFocus } from "@/lib/community-map";
import type { CommunityStoreDto } from "@/services/community-stores";

export default function StoreMapCanvas({ stores, selectedId, focus, userPosition, onSelect, onView, onPin }: {
  stores: CommunityStoreDto[]; selectedId: string; focus: MapFocus | null; userPosition: MapPoint | null;
  onSelect: (id: string) => void;
  onView: (bounds: MapBounds, center: MapPoint) => void;
  onPin?: (point: MapPoint) => void;
}) {
  const t = useTranslations("LocalStores");
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  const callbacks = useRef({ onSelect, onView, onPin });
  callbacks.current = { onSelect, onView, onPin };

  useEffect(() => {
    if (!host.current) return;
    const map = L.map(host.current, { zoomControl: false, scrollWheelZoom: false, worldCopyJump: true }).setView([62, 15], 5);
    mapRef.current = map;
    map.attributionControl.setPrefix(false);
    L.control.zoom({ position: "bottomright", zoomInTitle: t("zoomIn"), zoomOutTitle: t("zoomOut") }).addTo(map);
    // ⛔ Bara kartan användaren faktiskt öppnat laddas. Ingen förladdning/offline-
    // cache: OSM:s tile-policy förbjuder det. Webbläsaren sköter HTTP-cachen.
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, minZoom: 3, keepBuffer: 0, updateWhenIdle: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
      className: "community-map-tiles",
    }).addTo(map);
    tiles.on("tileerror", () => setTileError(true));
    tiles.on("tileload", () => setTileError(false));
    layer.current = L.layerGroup().addTo(map);
    const update = () => {
      const b = map.getBounds(); const c = map.getCenter();
      callbacks.current.onView({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, { latitude: c.lat, longitude: c.lng });
    };
    map.on("moveend resize", update);
    map.on("click", (event: L.LeafletMouseEvent) => callbacks.current.onPin?.({ latitude: event.latlng.lat, longitude: event.latlng.lng }));
    const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    resize.observe(host.current);
    update(); setReady(true);
    return () => { resize.disconnect(); map.remove(); mapRef.current = null; layer.current = null; };
    // Språket följer sidans locale; callbacks läses alltid färskt via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    const map = mapRef.current; const markers = layer.current;
    if (!ready || !map || !markers) return;
    function draw() {
      if (!map || !markers) return;
      markers.clearLayers();
      const positions = stores.filter(hasStorePosition);
      const clusters = storeClusters(positions, s => map.project([s.latitude, s.longitude]));
      for (const group of clusters) {
        const point = group.length === 1 ? group[0] : {
          latitude: group.reduce((sum, s) => sum + s.latitude, 0) / group.length,
          longitude: group.reduce((sum, s) => sum + s.longitude, 0) / group.length,
        };
        const title = group.length === 1 ? group[0].name : t("clusterStores", { count: group.length });
        const pin = document.createElement("span");
        pin.className = `community-map-pin${group.some(s => s.id === selectedId) ? " is-selected" : ""}${group.length > 1 ? " is-cluster" : ""}`;
        if (group.length === 1 && group[0].logoUrl) {
          const logo = document.createElement("img"); logo.src = group[0].logoUrl; logo.alt = "";
          logo.className = "h-full w-full rounded-full object-contain"; pin.appendChild(logo);
        } else pin.textContent = group.length > 1 ? String(group.length) : group[0].name.slice(0, 2).toUpperCase();
        const marker = L.marker([point.latitude, point.longitude], { title, alt: title, icon: L.divIcon({ html: pin, className: "community-map-marker", iconSize: [40, 40], iconAnchor: [20, 20] }) });
        marker.on("click", () => {
          if (group.length === 1 || map.getZoom() >= 18) callbacks.current.onSelect(group[0].id);
          else map.fitBounds(L.latLngBounds(group.map(s => [s.latitude, s.longitude])), { padding: [50, 50], maxZoom: map.getZoom() + 3 });
        }).addTo(markers);
        marker.getElement()?.setAttribute("aria-label", title);
      }
      if (userPosition) {
        const dot = document.createElement("span"); dot.className = "community-map-location";
        L.marker([userPosition.latitude, userPosition.longitude], { interactive: false, zIndexOffset: -1000, icon: L.divIcon({ html: dot, className: "community-map-marker", iconSize: [18, 18] }) }).addTo(markers);
      }
    }
    draw(); map.on("zoomend", draw);
    return () => { map.off("zoomend", draw); };
  }, [stores, selectedId, userPosition, ready, t]);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map && focus) {
      if (focus.bounds) {
        const b = focus.bounds;
        map.fitBounds([[b.south, b.west], [b.north, b.east]], { paddingTopLeft: [20, 108], paddingBottomRight: [20, 40], maxZoom: focus.zoom ?? 14 });
        return;
      }
      const zoom = focus.zoom ?? 13;
      // ⛔ I en 200 px telefonkarta hamnade mittmarkören under sökfiltren.
      // Flytta vyn i pixelplanet (inte butikens koordinat), med ETT tile-byte.
      const center = map.project([focus.latitude, focus.longitude], zoom).subtract([0, 48]);
      map.setView(map.unproject(center, zoom), zoom);
    }
  }, [focus, ready]);

  return <div className="relative isolate h-full overflow-hidden rounded-t-2xl" data-swipe-ignore data-drag-surface>
    {/* ⛔ Kartan äger sina drag; butikslistan under scrollar sidan utan en egen scrollbehållare. */}
    <div ref={host} className="community-store-map h-full w-full" style={{ touchAction: "none" }} aria-label={t("mapLabel")} />
    {tileError && <p role="status" className="absolute bottom-7 left-2 right-2 z-[500] rounded-lg bg-surface/90 p-2 text-xs text-ink">{t("mapUnavailable")}</p>}
  </div>;
}
