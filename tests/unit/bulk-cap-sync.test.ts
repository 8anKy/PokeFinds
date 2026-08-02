import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BULK_DETECTOR_MAX_CARDS } from "@/lib/camera-controls";

/**
 * Bulk-taket bor på TRE ställen och måste vara samma tal överallt:
 *   1. `BULK_MAX_CARDS` i skanna/page.tsx  — vad klienten skickar
 *   2. `cells.max(N)` i /api/scanner/identify-bulk — vad servern accepterar
 *   3. `BULK_DETECTOR_MAX_CARDS` i lib/camera-controls.ts — vad zoom-förvalens
 *      rekommendation klampas mot
 *
 * Glider de isär blir felet TYST och svårt att härleda: ett för lågt Zod-tak
 * avvisar HELA fångsten med 400 (inte bara överskottet), och ett för lågt
 * klient-tak kapar korten utan att någon får veta varför — precis det som
 * hände när ägaren la ut 15 kort och fick 12 (2026-08-02).
 *
 * De två första kan inte importeras (en Next-sidmodul och en route som drar in
 * prisma), så de läses ur källan. Ett textprov är trubbigt men fångar exakt den
 * drift det är till för.
 */
function readNumber(relPath: string, pattern: RegExp): number {
  const src = readFileSync(resolve(process.cwd(), relPath), "utf8");
  const m = src.match(pattern);
  expect(m, `hittade inte mönstret i ${relPath} — har konstanten döpts om?`).toBeTruthy();
  return Number(m![1]);
}

describe("bulk-takets tre kopior", () => {
  const clientCap = () =>
    readNumber("src/app/[locale]/(app)/skanna/page.tsx", /const BULK_MAX_CARDS = (\d+)/);
  // Cellistans tak står ENSAMT på sin rad; schemats övriga tak (.min(1).max(1024)
  // på fingeravtrycken, .max(8) på svepet) är inline. Ett bart
  // /\.max\((\d+)\)/ plockade 1024 — därför radankaret.
  const serverCap = () =>
    readNumber("src/app/api/scanner/identify-bulk/route.ts", /^\s+\.max\((\d+)\),/m);

  it("klienten och servern har samma tak", () => {
    expect(serverCap()).toBe(clientCap());
  });

  it("kamerakontrollernas spegling matchar klientens tak", () => {
    expect(BULK_DETECTOR_MAX_CARDS).toBe(clientCap());
  });

  it("taket är ett rimligt tal — en nolla eller en tappad siffra fångas", () => {
    expect(clientCap()).toBeGreaterThanOrEqual(6);
    expect(clientCap()).toBeLessThanOrEqual(40);
  });
});
