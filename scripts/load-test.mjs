// Enkel last-test utan beroenden. Kör samtidiga requests mot de dyraste
// publika ytorna och rapporterar latens (p50/p95/max) + fel per endpoint.
//
//   node scripts/load-test.mjs https://www.foilio.se [concurrency] [rounds]
//
// Hitta vilken mätare som rör sig först (Vercel/Railway CPU, Neon CU) genom att
// titta i respektive dashboard MEDAN detta kör. Default: 20 samtidiga × 5 rundor.
// OBS: kör mot din EGEN sajt — detta är ett verktyg, inte ett vapen.

const base = (process.argv[2] || "https://www.foilio.se").replace(/\/$/, "");
const concurrency = parseInt(process.argv[3] || "20", 10);
const rounds = parseInt(process.argv[4] || "5", 10);

// De tyngsta publika ytorna: katalogflöde, en produktsida, dess offers-API.
const paths = [
  "/produkter",
  "/api/products/feed",
  "/api/sets",
];

async function timeOne(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { redirect: "manual" });
    await res.arrayBuffer(); // läs klart svaret
    return { ms: performance.now() - t0, ok: res.status < 400, status: res.status };
  } catch (e) {
    return { ms: performance.now() - t0, ok: false, status: 0, err: String(e) };
  }
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);
}

async function main() {
  console.log(`Last-test → ${base}  (${concurrency} samtidiga × ${rounds} rundor)\n`);
  for (const path of paths) {
    const url = base + path;
    const samples = [];
    let fails = 0;
    for (let r = 0; r < rounds; r++) {
      const batch = await Promise.all(
        Array.from({ length: concurrency }, () => timeOne(url))
      );
      for (const b of batch) {
        samples.push(b.ms);
        if (!b.ok) fails++;
      }
    }
    samples.sort((a, b) => a - b);
    const n = samples.length;
    console.log(
      `${path.padEnd(24)} n=${n}  p50=${pct(samples, 0.5)}ms  ` +
        `p95=${pct(samples, 0.95)}ms  max=${Math.round(samples[n - 1])}ms  fel=${fails}`
    );
  }
  console.log("\nKlart. Titta i Neon/host-dashboarden för CU/CPU-toppar under körningen.");
}

main();
