/**
 * KILL-SWITCH (2026-06-29). Service workern är borttagen — den orsakade
 * cache-baserade reload-loopar i WebView:en. Den här filen finns bara kvar för
 * att redan registrerade SW:ar ska avregistrera sig själva och tömma alla cachar.
 * Cachar INGENTING. När den körts en gång finns ingen SW kvar.
 */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      await self.clients.claim();
    })()
  );
});

// Ingen fetch-hantering → allt går rakt till nätverket (ingen cache, ingen stale shell).
