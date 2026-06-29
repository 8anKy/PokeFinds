/**
 * Foilio service worker — minimal PWA-skal för installerbarhet.
 *
 * VIKTIGT (2026-06-29): den gamla versionen cachade HTML-navigeringar och
 * behöll cachen mellan deployer (CACHE-namnet bumpades aldrig). I native-
 * WebView:en gav det ett INAKTUELLT app-skal som pekade på borttagna JS-chunks
 * → Next hård-laddade om för att återhämta sig → samma stale skal → reload-loop
 * ("flimmer som en ficklampa"). Force-close hjälpte inte (SW-cachen överlever).
 *
 * Fix: bumpa version → rensa ALLA gamla cachar, ladda om klienter EN gång till
 * färskt innehåll. HTML-navigeringar cachas INTE längre (ingen stale shell);
 * bara immutabla, hash:ade statiska resurser cachas (säkert).
 */
const CACHE = "foilio-v3";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Rensa ALLT (inkl. ev. gamla shells) — bygg upp statisk cache på nytt.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
      // Bryt en pågående reload-loop: ladda varje öppet fönster en gång till
      // färskt nätverksinnehåll nu när stale-cachen är borta.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })()
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // API alltid live

  // Bara immutabla, hash:ade resurser cachas (kollisionsfria URL:er → aldrig stale).
  const isStatic =
    url.pathname.startsWith("/_next/static") ||
    /\.(?:png|jpe?g|svg|webp|gif|ico|woff2?)$/.test(url.pathname);

  if (isStatic) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML-navigeringar: alltid nätverk (ingen cache → ingen stale shell → ingen loop).
  // Lämnas annars orörd → webbläsaren hanterar den som vanligt.
});
