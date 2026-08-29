/**
 * KÖRS FÖRE `next start` (Dockerfile CMD). Utan volym (ingen `ISR_CACHE_DIR` /
 * `RAILWAY_VOLUME_MOUNT_PATH`) är det en no-op. Fel får ALDRIG stoppa starten.
 */
"use strict";

const path = require("node:path");
const { resolveCacheDir } = require("./cache-handler.cjs");
const { syncStaticAssets } = require("./isr-static-sync.cjs");

const cacheDir = resolveCacheDir();
if (!cacheDir) {
  console.log("[isr-cache-boot] ingen volym — hoppar över.");
} else {
  try {
    const r = syncStaticAssets({ cacheDir, buildStaticDir: path.join(process.cwd(), ".next", "static") });
    console.log(
      `[isr-cache-boot] ${cacheDir}: ${r.restored} chunks återställda, ${r.archived} arkiverade, ${r.pruned} rensade.`
    );
  } catch (err) {
    console.warn("[isr-cache-boot] misslyckades (startar ändå):", err);
  }
}
