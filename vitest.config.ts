import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Restock-larmen är PAUSADE i drift (src/lib/restock-alerts-pause.ts). Sviten
    // testar hur larmen ska bete sig NÄR de är på — pausen har ett eget test som
    // sätter variabeln själv. Utan raden hade varje befintligt larmtest blivit
    // grönt av fel skäl (noll larm, ingen assertion körd).
    env: { RESTOCK_ALERTS_PAUSED: "0" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
