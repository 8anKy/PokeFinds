"use client";

/**
 * IMPORTERA SAMLING FRÅN CSV — fyra steg: Fil → Kolumner → Granska → Klart.
 *
 * ⛔ GRANSKNINGSSTEGET ÄR INTE PYNT. Förra importflödet togs bort ur
 * gränssnittet 2026-08-11 för att det var "glitchigt": det matchade kort på
 * NAMN och skrev rakt in i samlingen, så användaren fick reda på vad som hänt
 * först när fel kort låg i portföljen. Nu ser man exakt vad som blir vad INNAN
 * något skrivs, och en tvetydig rad väljer man själv.
 *
 * ⛔ FILEN LÄSES I WEBBLÄSAREN. Ingen uppladdning, ingen bucket, inget
 * body-tak att spränga — bara cellerna skickas. Filen har ett hårt tak på
 * 5 000 rader och skrivs i ett atomiskt anrop.
 *
 * ⛔ ALLA RADER RENDERAS ALDRIG. Vi visar summorna och listar bara de rader som
 * KRÄVER ett beslut (de tvetydiga). En tabell med 5 000 rader är inte en
 * granskning, det är en frysning.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { SubpageHeader } from "@/components/layout/subpage-header";
import { Spinner } from "@/components/ui/spinner";
import { IconCheck, IconPackage, IconUpload, IconX } from "@/components/ui/icons";
import { apiFetch } from "@/lib/client-api";
import { parseCsv } from "@/lib/csv-parse";
import {
  autoMapColumns,
  IMPORT_FIELDS,
  type ColumnMapping,
  type MoneyUnit,
} from "@/lib/import-mapping";
import { inferDateOrder, type DateOrder, type MoneyCurrency } from "@/lib/import-normalize";

/** Radtak per fil. Över det är det inte längre en samling, det är en prislista. */
const MAX_ROWS = 5000;
/**
 * Rader per anrop — samma tak som servern verkställer.
 * ⛔ En fil = ett granskningsanrop + en atomisk skrivning. Mindre chunkar
 * väckte databasen gång på gång och kunde lämna en halv import om anrop 2 dog.
 */
const CHUNK = MAX_ROWS;

interface Candidate {
  cardId: string | null;
  productId: string | null;
  title: string;
  setName: string | null;
  number: string | null;
  variantLabel: string | null;
  imageUrl: string | null;
}
interface DraftWire {
  name: string;
  quantity: number;
  condition: string | null;
  language: string | null;
  purchasePrice: number | null;
  purchaseDate: string | null;
  estimatedValue: number | null;
  gradingCompany: string | null;
  grade: string | null;
  notes: string | null;
}
interface PreviewItem {
  row: number;
  status: "matched" | "ambiguous" | "unmatched";
  kind: string | null;
  match: Candidate | null;
  options: Candidate[];
  name: string;
  draft: DraftWire;
}
interface PreviewResponse {
  items: PreviewItem[];
  skippedEmpty: number;
  droppedForeignPrices: number;
  ignoredMarketValues: number;
  dateOrder: DateOrder;
  duplicate: { id: string; fileName: string; createdAt: string; rowCount: number } | null;
}

/** SHA-256 över filens text. Bara till dubblettvarningen — aldrig en spärr. */
async function fingerprint(text: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // Äldre WebView utan SubtleCrypto: en svag hash duger för en VARNING, och
    // att avbryta importen för att vi inte kunde varna vore fel prioritering.
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    return `weak-${(h >>> 0).toString(16)}-${text.length}`;
  }
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Step = "file" | "columns" | "review" | "done";

export default function ImportCollectionPage() {
  const t = useTranslations("CollectionImport");
  const router = useRouter();

  const [step, setStep] = useState<Step>("file");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filens celler ligger i en ref: de är stora, ändras aldrig efter parsningen
  // och ska inte trigga en omrendering.
  const cells = useRef<string[][]>([]);
  const fileText = useRef<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [rowCount, setRowCount] = useState(0);
  const [truncated, setTruncated] = useState(false);

  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [profileLabel, setProfileLabel] = useState<string | null>(null);
  const [profileId, setProfileId] = useState("generic");
  const [moneyUnit, setMoneyUnit] = useState<MoneyUnit>("major");
  const [currency, setCurrency] = useState<MoneyCurrency>("SEK");
  const [keepUnmatched, setKeepUnmatched] = useState(true);

  const [items, setItems] = useState<PreviewItem[]>([]);
  const [choice, setChoice] = useState<Record<number, number>>({});
  const [droppedPrices, setDroppedPrices] = useState(0);
  const [ignoredValues, setIgnoredValues] = useState(0);
  const [duplicate, setDuplicate] = useState<PreviewResponse["duplicate"]>(null);
  const [progress, setProgress] = useState(0);

  const [result, setResult] = useState<{ importId: string; imported: number } | null>(null);

  // ---- Steg 1: filen ----
  const onFile = useCallback(
    async (file: File) => {
      setError(null);
      setBusy(true);
      try {
        const text = await file.text();
        const parsed = parseCsv(text);
        if (parsed.headers.length === 0 || parsed.rows.length === 0) {
          setError(t("errorEmpty"));
          return;
        }
        const auto = autoMapColumns(parsed.headers);
        if (auto.mapping.name == null) {
          // Utan namnkolumn kan ingen rad bli något — men filen kan ändå vara
          // rätt, så vi går till kolumnsteget och låter användaren peka ut den.
          setError(t("errorNoName"));
        }
        fileText.current = text;
        cells.current = parsed.rows.slice(0, MAX_ROWS);
        setTruncated(parsed.rows.length > MAX_ROWS);
        setHeaders(parsed.headers);
        setRowCount(cells.current.length);
        setMapping(auto.mapping);
        setProfileLabel(auto.profile?.label ?? null);
        setProfileId(auto.profile?.id ?? "generic");
        setMoneyUnit(auto.moneyUnit);
        setFileName(file.name);
        setStep("columns");
      } catch {
        setError(t("errorRead"));
      } finally {
        setBusy(false);
      }
    },
    [t]
  );

  // ---- Steg 2 → 3: granskningen ----
  async function runPreview() {
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const hash = await fingerprint(fileText.current);
      const dateColumn = mapping.purchaseDate;
      const dateOrder = inferDateOrder(
        dateColumn == null ? [] : cells.current.map((r) => r[dateColumn] ?? "")
      );
      const parts = chunked(cells.current, CHUNK);
      const all: PreviewItem[] = [];
      let dropped = 0;
      let ignored = 0;
      let dup: PreviewResponse["duplicate"] = null;

      for (let i = 0; i < parts.length; i++) {
        const res = await apiFetch<PreviewResponse>("/api/collection/import/preview", {
          method: "POST",
          body: {
            rows: parts[i],
            mapping,
            moneyUnit,
            fileCurrency: currency,
            source: profileId,
            dateOrder,
            startRow: i * CHUNK + 1,
            ...(i === 0 ? { fingerprint: hash } : {}),
          },
        });
        all.push(...res.items);
        dropped += res.droppedForeignPrices;
        ignored += res.ignoredMarketValues;
        if (i === 0) dup = res.duplicate;
        setProgress(Math.round(((i + 1) / parts.length) * 100));
      }
      setItems(all);
      setDroppedPrices(dropped);
      setIgnoredValues(ignored);
      setDuplicate(dup);
      setChoice({});
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    let matched = 0;
    let ambiguous = 0;
    let unmatched = 0;
    for (const item of items) {
      if (item.status === "matched") matched++;
      else if (item.status === "ambiguous") ambiguous += choice[item.row] != null ? 0 : 1;
      else unmatched++;
    }
    // Valda tvetydiga räknas som matchade — det är vad de blir.
    matched += items.filter((i) => i.status === "ambiguous" && choice[i.row] != null).length;
    return { matched, ambiguous, unmatched };
  }, [items, choice]);

  const ambiguousItems = useMemo(
    () => items.filter((i) => i.status === "ambiguous"),
    [items]
  );

  // ---- Steg 3 → 4: skrivningen ----
  async function commit() {
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const hash = await fingerprint(fileText.current);
      const payload = items
        .map((item) => {
          const chosen =
            item.status === "matched"
              ? item.match
              : item.status === "ambiguous" && choice[item.row] != null
                ? item.options[choice[item.row]]
                : null;
          if (!chosen && !keepUnmatched) return null;
          return {
            row: item.row,
            name: item.draft.name,
            cardId: chosen?.cardId ?? null,
            productId: chosen?.productId ?? null,
            quantity: item.draft.quantity,
            condition: item.draft.condition,
            language: item.draft.language,
            purchasePrice: item.draft.purchasePrice,
            purchaseDate: item.draft.purchaseDate,
            estimatedValue: item.draft.estimatedValue,
            gradingCompany: item.draft.gradingCompany,
            grade: item.draft.grade,
            notes: item.draft.notes,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (payload.length === 0) {
        setError(t("errorNothingToImport"));
        return;
      }

      const res = await apiFetch<{ importId: string; imported: number }>(
        "/api/collection/import/commit",
        {
          method: "POST",
          body: { fileName, fingerprint: hash, source: profileId, items: payload },
        }
      );
      setProgress(100);
      setResult(res);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!result) return;
    setBusy(true);
    try {
      await apiFetch(`/api/collection/import/history?id=${result.importId}`, { method: "DELETE" });
      setResult(null);
      setStep("file");
      setItems([]);
      cells.current = [];
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SubpageHeader title={t("title")} subtitle={t("subtitle")} fallback="/samling" />

      {error && (
        <div className="rounded-lg border border-fall/40 bg-fall/10 px-3 py-2 text-sm text-ink">
          {error}
        </div>
      )}

      {step === "file" && <FileStep onFile={onFile} busy={busy} />}

      {step === "columns" && (
        <ColumnsStep
          headers={headers}
          mapping={mapping}
          setMapping={setMapping}
          profileLabel={profileLabel}
          fileName={fileName}
          rowCount={rowCount}
          truncated={truncated}
          currency={currency}
          setCurrency={setCurrency}
          keepUnmatched={keepUnmatched}
          setKeepUnmatched={setKeepUnmatched}
          sample={cells.current.slice(0, 3)}
          busy={busy}
          progress={progress}
          onBack={() => setStep("file")}
          onNext={runPreview}
        />
      )}

      {step === "review" && (
        <ReviewStep
          counts={counts}
          total={items.length}
          droppedPrices={droppedPrices}
          ignoredValues={ignoredValues}
          duplicate={duplicate}
          ambiguous={ambiguousItems}
          choice={choice}
          setChoice={setChoice}
          keepUnmatched={keepUnmatched}
          busy={busy}
          progress={progress}
          onBack={() => setStep("columns")}
          onCommit={commit}
        />
      )}

      {step === "done" && result && (
        <div className="space-y-4 rounded-xl border border-surface-border bg-surface p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-holo-cyan/15 text-holo-cyan">
            <IconCheck size={24} />
          </div>
          <div className="font-display text-xl font-bold text-ink">
            {t("doneTitle", { count: result.imported })}
          </div>
          <p className="text-sm text-ink-muted">{t("doneBody")}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={() => router.push("/samling")}>{t("goToCollection")}</Button>
            {/* ⛔ Ångra är inte en "är du säker"-ruta i förväg utan en riktig väg
                tillbaka EFTERÅT: fel i en import syns först när man ser listan. */}
            <Button variant="secondary" onClick={undo} loading={busy}>
              {t("undo")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Steg 1 ----------

function FileStep({ onFile, busy }: { onFile: (f: File) => void; busy: boolean }) {
  const t = useTranslations("CollectionImport");
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          over ? "border-holo-cyan bg-holo-cyan/5" : "border-surface-border bg-surface"
        }`}
      >
        {busy ? <Spinner /> : <IconUpload size={28} className="text-ink-muted" />}
        <div className="text-sm text-ink">{t("dropHint")}</div>
        <input
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
        <Button onClick={() => input.current?.click()} loading={busy}>
          {t("chooseFile")}
        </Button>
        <p className="text-xs text-ink-muted">{t("formatsHint")}</p>
      </div>

      <div className="rounded-xl border border-surface-border bg-surface p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <IconPackage size={16} /> {t("supportedTitle")}
        </div>
        <p className="text-sm text-ink-muted">{t("supportedBody")}</p>
      </div>
    </div>
  );
}

// ---------- Steg 2 ----------

function ColumnsStep(props: {
  headers: string[];
  mapping: ColumnMapping;
  setMapping: (m: ColumnMapping) => void;
  profileLabel: string | null;
  fileName: string;
  rowCount: number;
  truncated: boolean;
  currency: MoneyCurrency;
  setCurrency: (c: MoneyCurrency) => void;
  keepUnmatched: boolean;
  setKeepUnmatched: (v: boolean) => void;
  sample: string[][];
  busy: boolean;
  progress: number;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useTranslations("CollectionImport");
  const canContinue = props.mapping.name != null && !props.busy;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-surface-border bg-surface p-4">
        <div className="text-sm text-ink">
          {props.profileLabel
            ? t("recognized", { app: props.profileLabel })
            : t("interpreted")}
        </div>
        <div className="mt-1 text-xs text-ink-muted">
          {t("fileSummary", { file: props.fileName, rows: props.rowCount })}
          {props.truncated ? ` · ${t("truncated", { max: MAX_ROWS })}` : ""}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-surface-border bg-surface">
        <table className="w-full text-sm">
          <tbody>
            {IMPORT_FIELDS.map((field) => (
              <tr key={field} className="border-b border-surface-border last:border-0">
                <td className="w-2/5 px-3 py-2 text-ink-muted">{t(`field.${field}`)}</td>
                <td className="px-3 py-2">
                  <select
                    value={props.mapping[field] ?? ""}
                    onChange={(e) =>
                      props.setMapping({
                        ...props.mapping,
                        [field]: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="w-full rounded-md border border-surface-border bg-surface-overlay px-2 py-1.5 text-ink"
                  >
                    <option value="">{t("columnNone")}</option>
                    {props.headers.map((h, i) => (
                      <option key={`${h}-${i}`} value={i}>
                        {h || t("columnUnnamed", { n: i + 1 })}
                      </option>
                    ))}
                  </select>
                  <ColumnSample sample={props.sample} index={props.mapping[field] ?? null} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 rounded-xl border border-surface-border bg-surface p-4">
        <label className="block text-sm text-ink">
          {t("currencyLabel")}
          <select
            value={props.currency}
            onChange={(e) => props.setCurrency(e.target.value as MoneyCurrency)}
            className="mt-1 w-full rounded-md border border-surface-border bg-surface-overlay px-2 py-1.5 text-ink"
          >
            <option value="SEK">SEK</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="OTHER">{t("currencyOther")}</option>
          </select>
        </label>
        {/* ⛔ Ärlig text: vi räknar INTE om. Se import-rows.ts för varför. */}
        <p className="text-xs text-ink-muted">{t("currencyNote")}</p>

        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={props.keepUnmatched}
            onChange={(e) => props.setKeepUnmatched(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {t("keepUnmatched")}
            <span className="block text-xs text-ink-muted">{t("keepUnmatchedNote")}</span>
          </span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={props.onBack} disabled={props.busy}>
          {t("back")}
        </Button>
        <Button onClick={props.onNext} disabled={!canContinue} loading={props.busy}>
          {props.busy && props.progress > 0 ? `${props.progress}%` : t("continue")}
        </Button>
      </div>
    </div>
  );
}

function ColumnSample({ sample, index }: { sample: string[][]; index: number | null }) {
  if (index == null) return null;
  const values = sample.map((r) => (r[index] ?? "").trim()).filter(Boolean).slice(0, 3);
  if (values.length === 0) return null;
  return <div className="mt-1 truncate text-xs text-ink-muted">{values.join(" · ")}</div>;
}

// ---------- Steg 3 ----------

function ReviewStep(props: {
  counts: { matched: number; ambiguous: number; unmatched: number };
  total: number;
  droppedPrices: number;
  ignoredValues: number;
  duplicate: PreviewResponse["duplicate"];
  ambiguous: PreviewItem[];
  choice: Record<number, number>;
  setChoice: (c: Record<number, number>) => void;
  keepUnmatched: boolean;
  busy: boolean;
  progress: number;
  onBack: () => void;
  onCommit: () => void;
}) {
  const t = useTranslations("CollectionImport");
  const [shown, setShown] = useState(50);

  return (
    <div className="space-y-4">
      {props.duplicate && (
        <div className="rounded-lg border border-holo-cyan/40 bg-holo-cyan/10 px-3 py-2 text-sm text-ink">
          {t("duplicateWarning", {
            file: props.duplicate.fileName,
            date: new Date(props.duplicate.createdAt).toLocaleDateString(),
            rows: props.duplicate.rowCount,
          })}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat label={t("statMatched")} value={props.counts.matched} tone="good" />
        <Stat label={t("statAmbiguous")} value={props.counts.ambiguous} tone="warn" />
        <Stat label={t("statUnmatched")} value={props.counts.unmatched} tone="muted" />
      </div>

      {props.droppedPrices > 0 && (
        <div className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-xs text-ink-muted">
          {t("droppedPrices", { count: props.droppedPrices })}
        </div>
      )}

      {props.ignoredValues > 0 && (
        <div className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-xs text-ink-muted">
          {t("ignoredValues", { count: props.ignoredValues })}
        </div>
      )}

      {props.ambiguous.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-ink">{t("chooseTitle")}</div>
          <p className="text-xs text-ink-muted">{t("chooseNote")}</p>
          {props.ambiguous.slice(0, shown).map((item) => (
            <div
              key={item.row}
              className="rounded-lg border border-surface-border bg-surface p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="truncate text-sm text-ink">
                  <span className="text-ink-muted">#{item.row}</span> {item.name}
                </div>
                {props.choice[item.row] != null && (
                  <IconCheck size={16} className="shrink-0 text-holo-cyan" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {item.options.map((option, i) => {
                  const active = props.choice[item.row] === i;
                  return (
                    <button
                      key={`${item.row}-${i}`}
                      onClick={() => {
                        const next = { ...props.choice };
                        if (active) delete next[item.row];
                        else next[item.row] = i;
                        props.setChoice(next);
                      }}
                      className={`rounded-md border px-2 py-1 text-left text-xs transition-colors ${
                        active
                          ? "border-holo-cyan bg-holo-cyan/10 text-ink"
                          : "border-surface-border bg-surface-overlay text-ink-muted hover:text-ink"
                      }`}
                    >
                      <span className="block text-ink">{option.title}</span>
                      <span className="block">
                        {[option.setName, option.number && `#${option.number}`, option.variantLabel]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  );
                })}
                <button
                  onClick={() => {
                    const next = { ...props.choice };
                    delete next[item.row];
                    props.setChoice(next);
                  }}
                  className="rounded-md border border-surface-border px-2 py-1 text-xs text-ink-muted hover:text-ink"
                >
                  <IconX size={12} className="mr-1 inline" />
                  {t("skipRow")}
                </button>
              </div>
            </div>
          ))}
          {props.ambiguous.length > shown && (
            <Button variant="ghost" onClick={() => setShown(shown + 50)}>
              {t("showMore", { count: props.ambiguous.length - shown })}
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={props.onBack} disabled={props.busy}>
          {t("back")}
        </Button>
        <Button onClick={props.onCommit} loading={props.busy}>
          {props.busy && props.progress > 0
            ? `${props.progress}%`
            : t("importButton", {
                count: props.keepUnmatched
                  ? props.total
                  : props.counts.matched,
              })}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "good" | "warn" | "muted" }) {
  const color =
    tone === "good" ? "text-holo-cyan" : tone === "warn" ? "text-ink" : "text-ink-muted";
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3 text-center">
      <div className={`font-display text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-ink-muted">{label}</div>
    </div>
  );
}
