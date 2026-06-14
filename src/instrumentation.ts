/**
 * Next.js Instrumentation — körs en gång vid serverstart.
 *
 * Startar en in-process prisuppdaterings-loop om SCRAPE_INTERVAL_MINUTES
 * är satt (standard: 480 minuter = 8 timmar). Kräver ingen Redis eller
 * separat worker.
 *
 * Sätt SCRAPE_INTERVAL_MINUTES=0 för att stänga av auto-scrape.
 */
export async function register() {
  // Kör bara på servern (inte Edge runtime)
  if (process.env.NEXT_RUNTIME === "edge") return;

  // Frekvent restock-bevakning (oberoende av den fulla 8h-insamlingen): kör de
  // källor som flaggats config.restockWatch var ~45:e minut → tidiga restock-
  // alerts. Sätt RESTOCK_WATCH_MINUTES=0 för att stänga av.
  const restockMinutes = parseInt(process.env.RESTOCK_WATCH_MINUTES ?? "45", 10);
  if (restockMinutes > 0) {
    const restockMs = restockMinutes * 60 * 1000;
    console.log(`[instrumentation] Restock-bevakning var ${restockMinutes}:e minut.`);
    const runWatch = async () => {
      try {
        const { runRestockWatch } = await import("@/jobs/restock-watch");
        await runRestockWatch();
      } catch (err) {
        console.error("[restock-watch] Fel:", err instanceof Error ? err.message : err);
      }
    };
    setTimeout(() => {
      void runWatch();
      setInterval(() => void runWatch(), restockMs);
    }, 90_000); // 90 s efter boot (låt servern + första auto-scrape starta)
  }

  const intervalMinutes = parseInt(process.env.SCRAPE_INTERVAL_MINUTES ?? "480", 10);
  if (intervalMinutes <= 0) {
    console.log("[instrumentation] Auto-scrape avstängt (SCRAPE_INTERVAL_MINUTES=0).");
    return;
  }

  // Dynamisk import för att undvika att dra in server-beroenden i klienten
  const { runScheduledScrapesOnce } = await import("@/jobs/scheduler");

  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(
    `[instrumentation] Auto-scrape aktivt — kör var ${intervalMinutes}:e minut.`
  );

  // Första körning efter 30 sekunder (låt servern starta klart)
  const initialDelay = 30_000;

  // Cardmarket-prisrefresh (RapidAPI) körs max en gång/kalenderdygn — egen
  // 3000/dygn-kvot, tål inte 8h-tickens 3 körningar/dygn.
  let lastCmRefreshDay = "";

  const tick = async () => {
    try {
      console.log("[auto-scrape] Startar schemalagd insamling...");
      const result = await runScheduledScrapesOnce();
      console.log(
        `[auto-scrape] Klart: ${result.scrapes.length} källor, ${result.alerts.sent} alerts.`
      );

      const today = new Date().toISOString().slice(0, 10);
      if (today !== lastCmRefreshDay && process.env.CARDMARKET_RAPIDAPI_KEY) {
        lastCmRefreshDay = today;
        const { runCardmarketRefresh } = await import("@/jobs/cardmarket-refresh");
        const r = await runCardmarketRefresh();
        console.log(`[auto-scrape] CM-refresh: ${r.singlesUpdated} singlar, ${r.sealedUpdated} sealed.`);
      }
    } catch (err) {
      console.error("[auto-scrape] Fel:", err instanceof Error ? err.message : err);
    }
  };

  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), intervalMs);
  }, initialDelay);
}
