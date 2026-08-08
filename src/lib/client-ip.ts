/**
 * Trovärdig klient-IP bakom Railways edge-proxy (Envoy).
 *
 * ⛔ ANVÄND ALDRIG `x-forwarded-for`.split(",")[0] som rate-limit-nyckel. Den
 * VÄNSTRA posten i XFF är vad KLIENTEN skickade och kan förfalskas per förfrågan
 * — då blir hela spärren verkningslös (t.ex. mejl-bombning via /forgot: rotera
 * headern och 3-per-15-min-taket försvinner). Railway/Envoy lägger den FAKTISKT
 * observerade adressen i `x-envoy-external-address` (kan inte sättas av klienten)
 * och appenderar den SIST i x-forwarded-for.
 *
 * Ordning: (1) Envoys betrodda header, (2) HÖGRA XFF-posten (den som edge-proxyn
 * själv la till — den vänstra är klientens egen uppgift), (3) x-real-ip,
 * (4) "anon". Sista utväg får ALDRIG bli en tom sträng: då hade alla anonyma
 * anrop delat nyckel och en enda klient kunnat 429:a hela världen.
 */
export function clientIp(req: Request): string {
  const h = req.headers;

  const envoy = h.get("x-envoy-external-address")?.trim();
  if (envoy) return envoy;

  const xff = h.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }

  const real = h.get("x-real-ip")?.trim();
  if (real) return real;

  return "anon";
}
