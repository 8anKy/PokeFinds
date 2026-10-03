import { distanceMeters } from "./community-stores";
import type { CommunityStoreDto } from "@/services/community-stores";

export type MapBounds = { south: number; west: number; north: number; east: number };
export type MapPoint = { latitude: number; longitude: number };
export type MappedStore = CommunityStoreDto & MapPoint;

export function hasStorePosition(store: CommunityStoreDto): store is MappedStore {
  return store.latitude != null && store.longitude != null && Number.isFinite(store.latitude)
    && Number.isFinite(store.longitude) && Math.abs(store.latitude) <= 90 && Math.abs(store.longitude) <= 180;
}
export function storesInBounds(stores: CommunityStoreDto[], bounds: MapBounds, center: MapPoint): MappedStore[] {
  return stores.filter(hasStorePosition).filter(s => s.latitude >= bounds.south && s.latitude <= bounds.north
    && (bounds.west <= bounds.east ? s.longitude >= bounds.west && s.longitude <= bounds.east : s.longitude >= bounds.west || s.longitude <= bounds.east))
    .sort((a, b) => distanceMeters(a, center) - distanceMeters(b, center) || a.id.localeCompare(b.id));
}

/** Klustra bara på skärmen, aldrig genom nya databas-/karttjänstanrop. */
export function storeClusters(stores: MappedStore[], project: (s: MappedStore) => { x: number; y: number }, cellSize = 48) {
  const cells = new Map<string, MappedStore[]>();
  for (const store of stores) {
    const point = project(store);
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
    const group = cells.get(key) ?? [];
    group.push(store); cells.set(key, group);
  }
  return [...cells.values()];
}
