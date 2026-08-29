/**
 * VAD DRIFTEN KOSTAR — vår egen liggare först, leverantörernas API:er sedan.
 *
 * ⛔ TRE UTFALL, ALDRIG TVÅ (samma doktrin som kostnadsvyn per användare):
 * varje post är `ok` (vi har en siffra), `not_configured` (nyckeln saknas — vi
 * VET inte, och det är inte noll kronor) eller `error` (anropet gick fel). Slås
 * "saknas" ihop med "noll" ser en dyr tjänst gratis ut, vilket är precis fel håll
 * för en kostnadsvy.
 *
 * ⛔ VAD SOM INTE GÅR ATT HÄMTA, UTREDD 2026-08-26 — öppna inte frågan igen utan
 * ny information:
 *   · **Anthropics kvarvarande kredit**: det finns INGET publikt endpoint.
 *     `GET /v1/organizations/balance` svarar 404 och saknas i Admin-API:t; det
 *     ligger som en öppen feature request. Endast konsolen visar saldot. Vi kan
 *     däremot hämta FAKTISK KOSTNAD via `/v1/organizations/cost_report`.
 *   · **Geminis kvarvarande kredit**: Gemini är ingen förbetald kreditprodukt —
 *     den faktureras via Google Cloud Billing. "Credits left" finns alltså inte
 *     som begrepp, och Cloud Billings faktiska utfall kräver BigQuery-export
 *     (Budget-API:t ger budgeten, inte förbrukningen). Vår egen liggare är det
 *     enda ärliga Gemini-talet vi kan visa.
 *   · **Railway**: `usage`/`estimatedUsage` finns i deras GraphQL-schema men står
 *     INTE i den publika dokumentationen. Att skriva en fråga på gissning hade
 *     gett en tyst trasig integration — den läggs till när schemat introspekterats
 *     med en riktig token.
 */
import { prisma } from "@/lib/db";
import { getRatesOre } from "@/lib/exchange-rate";
import { costMicroUsd, microUsdToOre, priceForModel } from "@/lib/ai-pricing";
import { startOfMonthUtc } from "@/lib/utils";
import { classifyCostRow } from "@/services/admin/user-costs";

/** Hur länge ett leverantörssvar återanvänds. Deras data är ändå minuter gammal. */
const EXTERNAL_TTL_MS = 15 * 60 * 1000;
/** Vägrar hänga adminsidan på en trög leverantör. */
const EXTERNAL_TIMEOUT_MS = 8000;

export type CostSource<T> =
  | { status: "ok"; data: T }
  | { status: "not_configured"; envVar: string; note: string }
  | { status: "error"; message: string };

export interface LedgerBucket {
  key: string;
  label: string;
  costOre: number;
  calls: number;
  /** Rader med avtryck men utan pris/tokental. ⛔ Visas alltid — omätt är inte gratis. */
  unmeasured: number;
  /** Anrop som aldrig gick till ett API (bilden avgjorde). Äkta noll kronor. */
  free: number;
}

export interface AiLedger {
  /** Per leverantör (Anthropic / Google). */
  byProvider: LedgerBucket[];
  /** Per funktion (skanner / gradering). */
  byFeature: LedgerBucket[];
  totalOre: number;
  totalUnmeasured: number;
  totalFree: number;
  unpricedModels: string[];
  since: Date;
}

interface LedgerRow {
  model: string | null;
  /**
   * Bar raden ett kostnadsavtryck alls?
   * ⛔ SKILJER GRATIS FRÅN OMÄTT. En skannerrad utan `costModel` betyder att
   * BILDEN avgjorde och inget API-anrop gjordes — den är gratis, inte okänd.
   * `->>` kan inte skilja "nyckeln saknas" från "värdet är null", därav
   * `jsonb_exists()` som egen kolumn. Utan den redovisades hela den kostnadsfria
   * bild-först-vägen (~1 500 anrop/mån) som omätt, vilket överdriver osäkerheten
   * lika mycket som motsatsen underdriver notan.
   */
  hasCost: boolean;
  rows: unknown;
  inputTokens: unknown;
  outputTokens: unknown;
}

/**
 * ⛔ `SUM(bigint)` I POSTGRES ÄR `numeric`, INTE `bigint` — och Prisma mappar
 * numeric till `Prisma.Decimal`, ett OBJEKT. En `typeof v === "bigint"`-gren
 * släppte alltså igenom Decimal orörd, `costMicroUsd()` såg något som inte var
 * ett tal och returnerade null, och HELA liggaren redovisades som OMÄTT: 0 kr
 * och 2 329 "omätta" anrop i produktion 2026-08-26, för modeller som stod i
 * prislistan. `Number()` klarar bigint, Decimal och sträng. Samma helper som
 * user-costs.ts redan använde — den här filen uppfann en egen och fick det fel.
 */
const num = (v: unknown): number => Number(v ?? 0);

/**
 * Leverantör ur modellnamnet. ⛔ Prefixmatchning, inte en handlista: en ny
 * `gemini-4-*` ska hamna rätt utan kodändring, och det som inte matchar
 * redovisas som "Okänd" i stället för att tyst hamna hos fel leverantör.
 */
export function providerOf(model: string | null): { key: string; label: string } {
  if (!model) return { key: "unknown", label: "Okänd modell" };
  if (model.startsWith("claude")) return { key: "anthropic", label: "Anthropic (Claude)" };
  if (model.startsWith("gemini")) return { key: "google", label: "Google (Gemini)" };
  return { key: "unknown", label: "Okänd modell" };
}

/**
 * VÅR EGEN LIGGARE: kostnaden räknad ur API:ernas EGNA tokental × priset i
 * `ai-pricing.ts`. Ingen schablon, ingen extern nyckel, ingen kostnad att hämta.
 *
 * ⛔ Detta är inte ett estimat av fakturan — det ÄR samma uträkning som
 * `/admin/anvandare` gör per användare, bara summerad över hela basen. Skiljer
 * den sig från fakturan är det prislistan i `ai-pricing.ts` som ska rättas, inte
 * den här vyn.
 *
 * ⚠️ **PRISET ÄR INTE ALLTID LISTPRISET.** Gemini 3.1 Flash-Lite bär sedan
 * 2026-08-29 ett INPRIS kalibrerat mot Googles konsol 2026-08-02 (utpriset är
 * kvar på listpris — fakturan kan inte se det, se uträkningen i `ai-pricing.ts`).
 * Beloppet här är alltså så nära fakturan vi kommer utan att läsa en ny; en NY
 * konsolsiffra hör hemma i prislistan, med datum, aldrig i `AI_PRICE_OVERRIDES`
 * (den bär varken källa eller datum).
 */
export async function getAiLedger(since: Date = startOfMonthUtc()): Promise<AiLedger> {
  // ⛔ `getRatesOre()`, inte den synkrona: en webbrequest har inte hämtat kursen
  // och hade annars fått FALLBACK-kursen. Samma fälla som user-costs.ts.
  const { usdToOre } = await getRatesOre();

  const [scanRows, gradeRows] = await Promise.all([
    prisma.$queryRaw<LedgerRow[]>`
      SELECT
        "result"->>'costModel' AS "model",
        COALESCE(jsonb_exists("result", 'costModel'), false) AS "hasCost",
        COUNT(*) AS "rows",
        COALESCE(SUM(("result"->'costUsage'->>'inputTokens')::bigint), 0)  AS "inputTokens",
        COALESCE(SUM(("result"->'costUsage'->>'outputTokens')::bigint), 0) AS "outputTokens"
      FROM "ScannerJob"
      WHERE "createdAt" >= ${since} AND "status" <> 'FAILED'
      GROUP BY 1, 2
    `,
    prisma.$queryRaw<LedgerRow[]>`
      SELECT
        "modelUsed" AS "model",
        COALESCE(("result"->'costUsage') IS NOT NULL AND jsonb_typeof("result"->'costUsage') = 'object', false) AS "hasCost",
        COUNT(*) AS "rows",
        COALESCE(SUM(("result"->'costUsage'->>'inputTokens')::bigint), 0)  AS "inputTokens",
        COALESCE(SUM(("result"->'costUsage'->>'outputTokens')::bigint), 0) AS "outputTokens"
      FROM "GradingJob"
      WHERE "createdAt" >= ${since} AND "status" <> 'FAILED'
      GROUP BY 1, 2
    `,
  ]);

  const providers = new Map<string, LedgerBucket>();
  const features = new Map<string, LedgerBucket>();
  const unpriced = new Set<string>();
  let totalOre = 0;
  let totalUnmeasured = 0;
  let totalFree = 0;

  const featureLabels: Record<string, string> = {
    scanner: "Kortskanning",
    grading: "AI-gradering",
  };

  for (const [featureKey, rows] of [
    ["scanner", scanRows],
    ["grading", gradeRows],
  ] as const) {
    for (const row of rows) {
      const calls = num(row.rows);
      const micro =
        row.model === null
          ? null
          : costMicroUsd(row.model, {
              inputTokens: num(row.inputTokens),
              outputTokens: num(row.outputTokens),
            });
      /**
       * ⛔ TRE UTFALL, ALDRIG TVÅ — och grenarna får INTE kastas om. Den här
       * filen hade först sin egen variant med `!hasCost` = gratis, vilket är
       * precis tvärtom: då såg den kostnadsfria bild-först-vägen okänd ut och de
       * verkligt okända såg gratis ut. Definitionen bor numera på ETT ställe.
       */
      const outcome = classifyCostRow(row.hasCost, row.model, micro);
      const ore = outcome === "priced" && micro != null ? microUsdToOre(micro, usdToOre) : 0;
      const unmeasured = outcome === "unmeasured" ? calls : 0;
      const free = outcome === "free" ? calls : 0;
      // ⛔ "Saknar pris" är inte samma sak som "omätt": en prissatt modell vars
      //    rader saknar tokental är också omätt, men den hör inte hemma i
      //    listan över modeller att lägga in i prislistan.
      if (outcome === "unmeasured" && row.model && !priceForModel(row.model)) {
        unpriced.add(row.model);
      }

      totalOre += ore;
      totalUnmeasured += unmeasured;
      totalFree += free;

      const prov = providerOf(row.model);
      const p = providers.get(prov.key) ?? {
        key: prov.key,
        label: prov.label,
        costOre: 0,
        calls: 0,
        unmeasured: 0,
        free: 0,
      };
      p.costOre += ore;
      p.calls += calls;
      p.unmeasured += unmeasured;
      p.free += free;
      providers.set(prov.key, p);

      const f = features.get(featureKey) ?? {
        key: featureKey,
        label: featureLabels[featureKey],
        costOre: 0,
        calls: 0,
        unmeasured: 0,
        free: 0,
      };
      f.costOre += ore;
      f.calls += calls;
      f.unmeasured += unmeasured;
      f.free += free;
      features.set(featureKey, f);
    }
  }

  const sort = (m: Map<string, LedgerBucket>) =>
    [...m.values()].sort((a, b) => b.costOre - a.costOre);

  return {
    byProvider: sort(providers),
    byFeature: sort(features),
    totalOre,
    totalUnmeasured,
    totalFree,
    unpricedModels: [...unpriced].sort(),
    since,
  };
}

/** En enkel process-lokal cache. Adminsidan är force-dynamic; detta räcker. */
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < EXTERNAL_TTL_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** ⛔ Ett hängande leverantörsanrop får aldrig hänga adminsidan. */
async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }
  return res.json();
}

/**
 * Anthropics belopp → öre.
 *
 * ⛔ `amount` ÄR CENT, INTE DOLLAR. Dokumentationen är explicit: `"123.45"` i
 * `"USD"` betyder 1,2345 USD. Läses strängen som dollar blir hela notan 100×
 * för hög — och en kostnadsvy som visar 100× fel är värre än ingen alls. Egen
 * funktion just för att felet är tyst och testet ska kunna peka på det.
 */
export function anthropicCentsToOre(cents: number, usdToOre: number): number {
  return microUsdToOre((cents / 100) * 1_000_000, usdToOre);
}

export interface AnthropicCost {
  /** Faktisk kostnad denna månad, i öre. */
  costOre: number;
  /** Per beskrivning (modell/typ), störst först. */
  breakdown: { label: string; costOre: number }[];
  from: Date;
}

/**
 * Anthropics FAKTISKA kostnad via Admin-API:t.
 *
 * ⛔ Kräver en ADMIN-nyckel (`sk-ant-admin01-…`), inte den vanliga API-nyckeln —
 * en vanlig nyckel ger 401 här. Skapas i konsolen under Settings → Admin keys.
 * ⛔ Beloppen kommer som decimalsträngar i LÄGSTA valutaenhet (cent), inte
 * dollar: `"123.45"` betyder 1,2345 USD. Läs dem som cent och gå via kursen —
 * tolkar man dem som dollar blir notan 100× för hög.
 * ⛔ Endast dygnsupplösning (`bucket_width=1d`), max 31 hinkar per sida.
 */
export async function getAnthropicCost(): Promise<CostSource<AnthropicCost>> {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) {
    return {
      status: "not_configured",
      envVar: "ANTHROPIC_ADMIN_KEY",
      note: "Admin-nyckel (sk-ant-admin01-…), skapas i Claude Console → Settings. Skild från ANTHROPIC_API_KEY.",
    };
  }
  return cached("anthropic-cost", async () => {
    try {
      const from = startOfMonthUtc();
      const { usdToOre } = await getRatesOre();
      const url =
        "https://api.anthropic.com/v1/organizations/cost_report" +
        `?starting_at=${from.toISOString()}` +
        "&bucket_width=1d&limit=31&group_by[]=description";
      const json = (await fetchJson(url, {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "user-agent": "Foilio/1.0 (https://foilio.se)",
        },
      })) as {
        data?: { results?: { amount?: string; currency?: string; description?: string | null }[] }[];
      };

      const byLabel = new Map<string, number>();
      let totalCents = 0;
      for (const bucket of json.data ?? []) {
        for (const r of bucket.results ?? []) {
          const cents = Number(r.amount ?? 0);
          if (!Number.isFinite(cents)) continue;
          totalCents += cents;
          const label = r.description ?? "Övrigt";
          byLabel.set(label, (byLabel.get(label) ?? 0) + cents);
        }
      }
      const toOre = (cents: number) => anthropicCentsToOre(cents, usdToOre);

      return {
        status: "ok" as const,
        data: {
          costOre: toOre(totalCents),
          breakdown: [...byLabel.entries()]
            .map(([label, cents]) => ({ label, costOre: toOre(cents) }))
            .sort((a, b) => b.costOre - a.costOre)
            .slice(0, 8),
          from,
        },
      };
    } catch (e) {
      return { status: "error" as const, message: e instanceof Error ? e.message : String(e) };
    }
  });
}

export interface NeonCost {
  computeUnitHours: number;
  /** Beräknad kostnad = CU-timmar × priset per CU-timme. */
  costOre: number;
  cuHourUsd: number;
  storageGiB: number | null;
  from: Date;
}

/**
 * Neons FÖRBRUKNING via consumption-API:t.
 *
 * ⛔ NEON RETURNERAR FÖRBRUKNING, INTE KRONOR. `compute_unit_seconds` är CPU-tid
 * viktad med compute-storleken; priset per CU-timme beror på planen och står
 * INTE i svaret. Därav `NEON_CU_HOUR_USD` — sätt den till planens faktiska pris
 * (Launch $0,106 · Scale $0,222 vid kontroll 2026-08-26). Beloppet är alltså en
 * UTRÄKNING på vår sida, och märks som sådan i vyn. ⛔ Hitta aldrig på ett pris
 * som ser rimligt ut: hellre "okänt" än en siffra ägaren tror är fakturan.
 * ⛔ Kräver betald plan; på gratisplanen svarar endpointen inte med data.
 */
export async function getNeonCost(): Promise<CostSource<NeonCost>> {
  const key = process.env.NEON_API_KEY;
  const orgId = process.env.NEON_ORG_ID;
  if (!key || !orgId) {
    return {
      status: "not_configured",
      envVar: !key ? "NEON_API_KEY" : "NEON_ORG_ID",
      note: "API-nyckel från Neon Console → Account settings → API keys, plus organisations-id. Kräver betald plan.",
    };
  }
  return cached("neon-cost", async () => {
    try {
      const from = startOfMonthUtc();
      const { usdToOre } = await getRatesOre();
      const cuHourUsd = Number(process.env.NEON_CU_HOUR_USD ?? "0.106");
      const url =
        "https://console.neon.tech/api/v2/consumption_history/account" +
        `?from=${from.toISOString()}&to=${new Date().toISOString()}` +
        `&granularity=daily&org_id=${encodeURIComponent(orgId)}`;
      const json = (await fetchJson(url, {
        headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      })) as {
        periods?: {
          consumption?: {
            compute_time_seconds?: number;
            synthetic_storage_size_bytes?: number;
          }[];
        }[];
      };

      let computeSeconds = 0;
      let storageBytes = 0;
      for (const p of json.periods ?? []) {
        for (const c of p.consumption ?? []) {
          computeSeconds += c.compute_time_seconds ?? 0;
          storageBytes = Math.max(storageBytes, c.synthetic_storage_size_bytes ?? 0);
        }
      }
      const cuHours = computeSeconds / 3600;
      return {
        status: "ok" as const,
        data: {
          computeUnitHours: cuHours,
          costOre: microUsdToOre(cuHours * cuHourUsd * 1_000_000, usdToOre),
          cuHourUsd,
          storageGiB: storageBytes > 0 ? storageBytes / 1024 ** 3 : null,
          from,
        },
      };
    } catch (e) {
      return { status: "error" as const, message: e instanceof Error ? e.message : String(e) };
    }
  });
}

export interface ServiceCosts {
  ledger: AiLedger;
  anthropic: CostSource<AnthropicCost>;
  neon: CostSource<NeonCost>;
}

export async function getServiceCosts(): Promise<ServiceCosts> {
  const [ledger, anthropic, neon] = await Promise.all([
    getAiLedger(),
    getAnthropicCost(),
    getNeonCost(),
  ]);
  return { ledger, anthropic, neon };
}
