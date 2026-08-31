-- Marknadsstatistikens 24h-count (getMarketStatsRaw) filtrerar på enbart observedAt.
-- Enda indexet hade productId först => fullskanning, ~2,3M rader, 15 s per anrop vid
-- 0,25 CU (pg_stat-mätt 2026-08-31). Idempotent med flit.
CREATE INDEX IF NOT EXISTS "PriceObservation_observedAt_idx" ON "PriceObservation"("observedAt");
