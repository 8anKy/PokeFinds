import { z } from "zod";

export const STORE_OBSERVATIONS = ["SEEN", "SOLD_OUT", "NOT_CARRIED"] as const;
export type StoreObservation = (typeof STORE_OBSERVATIONS)[number];
export const REPORT_FRESH_HOURS = 12;
export const MAX_VISIT_AGE_DAYS = 7;
export const COMMUNITY_STORES_TAG = "community-stores";

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10000),
  sampledAt: z.string().datetime(),
});
export const storeSuggestionSchema = z.object({
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().min(3).max(160),
  city: z.string().trim().min(2).max(80),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
}).refine(v => (v.latitude == null) === (v.longitude == null));
export const storeReportSchema = z.object({
  storeId: z.string().min(1).max(64),
  productLabel: z.string().trim().min(2).max(120),
  productSlug: z.string().trim().min(1).max(200).optional(),
  observation: z.enum(STORE_OBSERVATIONS),
  observedAt: z.string().datetime(),
  location: locationSchema.optional(),
});
export type StoreReportInput = z.infer<typeof storeReportSchema>;

export function storeIdentity(name: string, address: string, city: string): string {
  // Filialens adress måste överleva normaliseringen; samma kedja har flera butiker.
  return [name, address, city].map(v => v.normalize("NFKC").toLocaleLowerCase("sv-SE")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim()).join("|");
}
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * rad;
  const lon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function validVisitTime(observedAt: string, now = Date.now()): boolean {
  const time = Date.parse(observedAt);
  return Number.isFinite(time) && time <= now && time >= now - MAX_VISIT_AGE_DAYS * 86400000;
}
export function reportIsFresh(observedAt: string, now = Date.now()): boolean {
  const time = Date.parse(observedAt);
  return Number.isFinite(time) && time <= now && now - time < REPORT_FRESH_HOURS * 3600000;
}
export function nearbyAtSubmit(store: { latitude: number | null; longitude: number | null }, report: StoreReportInput, now = Date.now()): boolean {
  const location = report.location;
  // ⛔ Hemmarapporter får ingen platsmarkering bara för att hemmet ligger nära.
  // Dålig GPS och gamla besök får heller aldrig se ut som kontrollerade på plats.
  if (!location || store.latitude == null || store.longitude == null || location.accuracy > 100
    || !validVisitTime(location.sampledAt, now) || now - Date.parse(location.sampledAt) > 2 * 60000
    || !validVisitTime(report.observedAt, now) || now - Date.parse(report.observedAt) > 10 * 60000) return false;
  return distanceMeters(location, { latitude: store.latitude, longitude: store.longitude }) + location.accuracy <= 250;
}
