/**
 * SPRÅKDOMEN PÅ ONE PIECE-ANNONSERNAS FOTON — körning + cache (2026-11-13).
 *
 * Reglerna bor i `lib/op-listing-language.ts` (ren, testad) och bildjämförelsen i
 * `scripts/op-listing-language.py` (OpenCV). Här: läs cachen, skicka de OBEDÖMDA annonserna till
 * Python-skriptet inom en tidsbudget, skriv cachen. Ingen databas.
 *
 * Cachen är en fil (`OP_LANG_CACHE_FILE`, default `.op-lang-cache/verdicts.json`) som workflowet
 * bär mellan nätterna i Actions-cachen. Försvinner den bedöms allt om (~2 400 foton, några nätter
 * à budgeten) — under tiden sätter obedömda annonser inget pris (fail closed).
 *
 * ⛔ Kastar aldrig: saknas Python/OpenCV, eller dör skriptet, är resultatet "inga nya domar".
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  mergeOpLanguageCache,
  orderPendingByPriceRank,
  parseOpLanguageCache,
  settledVerdict,
  type OpLanguageCache,
} from "@/lib/op-listing-language";

const SCRIPT = path.join(process.cwd(), "scripts", "op-listing-language.py");

export function opLanguageCacheFile(): string {
  return process.env.OP_LANG_CACHE_FILE ?? path.join(process.cwd(), ".op-lang-cache", "verdicts.json");
}

/** Cachen som den ligger på disk (tom när filen saknas). Sålt-svepet läser bara. */
export function readOpLanguageCache(): OpLanguageCache {
  const file = opLanguageCacheFile();
  return parseOpLanguageCache(existsSync(file) ? readFileSync(file, "utf8") : null);
}

export interface OpLanguageInput {
  itemId: string;
  code: string;
  productId: string;
  priceOre: number;
  photo: string | null;
  ref: string | null;
}

/**
 * Domar för nattens singelträffar. Redan bedömda annonser kostar ingenting; nya bedöms billigaste-
 * per-produkt först tills budgeten (`OP_LANG_BUDGET_SECONDS`, default 600) är slut.
 */
export async function judgeOnePieceListingLanguage(
  candidates: readonly OpLanguageInput[],
  seenItemIds: ReadonlySet<string>,
  log: (s: string) => void
): Promise<OpLanguageCache> {
  const cache = readOpLanguageCache();
  const pending = orderPendingByPriceRank(
    candidates.filter((c) => c.photo && c.ref && settledVerdict(cache, c.itemId) === null)
  );
  const noPhoto = candidates.filter((c) => !c.photo || !c.ref).length;
  let fresh: Record<string, { v: string; d?: number; n?: number }> = {};
  if (pending.length > 0) fresh = runChecker(pending, log);

  const merged = mergeOpLanguageCache(cache, fresh, seenItemIds, Date.now());
  try {
    const file = opLanguageCacheFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(merged));
  } catch (e) {
    log(`::warning::[op-lang] kunde inte skriva cachen: ${(e as Error).message}`);
  }

  const counts: Record<string, number> = {};
  for (const c of candidates) {
    const v = merged[c.itemId]?.v ?? "ingen dom";
    counts[v] = (counts[v] ?? 0) + 1;
  }
  log(
    `[op-lang] ${candidates.length} singelträffar: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(" · ")}` +
      ` — ${Object.keys(fresh).length} nya domar i natt, ${Math.max(0, pending.length - Object.keys(fresh).length)} väntar` +
      (noPhoto ? `, ${noPhoto} utan foto/referens` : "") +
      "."
  );
  return merged;
}

function runChecker(pending: readonly OpLanguageInput[], log: (s: string) => void): Record<string, { v: string; d?: number; n?: number }> {
  const budget = Math.max(30, Number(process.env.OP_LANG_BUDGET_SECONDS ?? 600) || 600);
  const dir = path.join(tmpdir(), `op-lang-${process.pid}`);
  const input = path.join(dir, "in.json");
  const output = path.join(dir, "out.json");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(input, JSON.stringify(pending.map((p) => ({ itemId: p.itemId, code: p.code, photo: p.photo, ref: p.ref }))));
    const python = process.env.OP_LANG_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
    const run = spawnSync(python, [SCRIPT, input, output, String(budget)], {
      encoding: "utf8",
      timeout: (budget + 120) * 1000,
    });
    if (run.stdout?.trim()) log(run.stdout.trim());
    if (run.error || run.status !== 0) {
      log(`::warning::[op-lang] bildkollen kördes inte klart (${run.error?.message ?? `exit ${run.status}`}): ${(run.stderr ?? "").slice(-300)}`);
    }
    return existsSync(output) ? (JSON.parse(readFileSync(output, "utf8")) as Record<string, { v: string; d?: number; n?: number }>) : {};
  } catch (e) {
    log(`::warning::[op-lang] bildkollen föll: ${(e as Error).message}`);
    return {};
  }
}
