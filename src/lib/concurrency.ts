/**
 * Kör `fn` över `items` med högst `concurrency` samtidiga anrop. Används för att
 * inte serialisera tusentals DB-skrivningar över en hög-latens-anslutning
 * (GitHub-runner i USA → Neon i Frankfurt) — sekventiellt tar det >30 min och
 * jobbet hinner timeouta. Håll `concurrency` ≤ DB-poolens storlek (se DB_POOL i
 * db.ts) så att köade queries inte slår i pool_timeout.
 */
export async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
}
