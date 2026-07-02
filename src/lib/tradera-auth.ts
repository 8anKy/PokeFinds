/**
 * Tradera kontokoppling — "token login", Option 3 (token i retur-URL:en).
 * Användaren loggar in på Tradera, godkänner appen, och Tradera lägger
 * `token`, `exp` och `userId` direkt på vår Accept URL. Ingen FetchToken,
 * ingen skey-round-trip (skey krävs bara för Option 1 och 2).
 * Kräver "Display token on return URL" = PÅ i appens Tradera-inställningar.
 * https://api.tradera.com/documentation/authorization
 */
// Railway-panelen visar värdet utan citattecken, men det injicerade env-värdet
// har visat sig ändå innehålla omslutande "..." — trimma bort dem oavsett källa.
const stripQuotes = (v: string) => v.trim().replace(/^["']|["']$/g, "");
const APP_ID = stripQuotes(process.env.TRADERA_APP_ID ?? "");
const PUBLIC_KEY = stripQuotes(process.env.TRADERA_PUBLIC_KEY ?? "");

export function buildTraderaLoginUrl(): string {
  const params = new URLSearchParams({ appId: APP_ID, pkey: PUBLIC_KEY });
  return `https://api.tradera.com/token-login?${params.toString()}`;
}
