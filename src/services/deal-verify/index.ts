/**
 * Väljer LLM-leverantör för fynd-/matchningsverifieringen. Samma adaptermönster
 * som skannern (`src/services/scanner/index.ts`) och graderingen: prompten och
 * svarstolkningen är delade (`contract.ts`), leverantören är ett env-val.
 *
 * ⛔ STANDARD = CLAUDE, MED FLIT. Gemini-domen på just den här uppgiften är
 * OMÄTT, och den här funktionens falska positiva blir FALSKA FYND i en betald
 * feed — vi har redan en incident där LLM-verifieringen VÄLSIGNADE tre
 * felmatchningar (2026-07-07). En default som byter modell i samma sekund som
 * någon deployar är därför fel form: bytet ska vara ett medvetet env-val som går
 * att ångra på en omstart, utan kodändring.
 *
 * Sätt `DEALS_VERIFY_PROVIDER=gemini` (+ GEMINI_API_KEY) för att flytta över,
 * och tillbaka till `claude` om kvaliteten faller.
 *
 * ⛔ MODELLNAMNEN HAR EGNA VARIABLER PER LEVERANTÖR. Ett delat
 * `DEALS_VERIFY_MODEL` hade betytt att ett provider-byte tyst skickar ett
 * Claude-modellnamn till Google (404 på varje anrop, dvs noll verifieringar och
 * en tom Fynd-feed) — samma klass av tyst fel som skannerns SCANNER_MODEL redan
 * kan råka ut för.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ClaudeDealVerifyAdapter } from "@/services/deal-verify/claude";
import { GeminiDealVerifyAdapter } from "@/services/deal-verify/gemini";
import type { DealVerifyAdapter } from "@/services/deal-verify/contract";

const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5-20251001";
/** 3.1, inte 2.5: 2.5-serien är spärrad för nya API-nycklar (se gemini.ts). */
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

/**
 * Returnerar konfigurerad adapter, eller `null` när leverantörens nyckel saknas
 * (jobbet hoppar då över tyst — samma beteende som förut utan ANTHROPIC_API_KEY).
 *
 * ⛔ `||` och inte `??`: GitHub Actions sätter en oangiven `vars.X` till TOM
 * STRÄNG, inte till undefined. Med `??` hade en oanvänd workflow-rad blivit en
 * okänd leverantör och slagit ut hela verifieringen.
 */
export function getDealVerifyAdapter(
  log: (msg: string) => void = console.log
): DealVerifyAdapter | null {
  const provider = process.env.DEALS_VERIFY_PROVIDER || "claude";
  switch (provider) {
    case "claude": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        log("[deal-verify] ANTHROPIC_API_KEY saknas — verifieringen hoppas över.");
        return null;
      }
      return new ClaudeDealVerifyAdapter(
        process.env.DEALS_VERIFY_MODEL || DEFAULT_CLAUDE_MODEL,
        new Anthropic({ apiKey })
      );
    }
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        log("[deal-verify] GEMINI_API_KEY saknas — verifieringen hoppas över.");
        return null;
      }
      return new GeminiDealVerifyAdapter(
        process.env.DEALS_VERIFY_MODEL_GEMINI || DEFAULT_GEMINI_MODEL,
        apiKey
      );
    }
    default:
      // ⛔ Aldrig en tyst fallback till en leverantör som INTE efterfrågades:
      // en felstavad variabel ska ge noll verifieringar (dvs inga nya fynd), inte
      // en oväntad modell som skriver domar i DealCheck.
      log(`[deal-verify] okänd DEALS_VERIFY_PROVIDER="${provider}" — verifieringen hoppas över.`);
      return null;
  }
}

export type { DealVerification, DealVerifyAdapter } from "@/services/deal-verify/contract";
