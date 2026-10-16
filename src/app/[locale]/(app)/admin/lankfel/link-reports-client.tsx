"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { formatPrice } from "@/lib/format";

export interface OfferReportRow {
  id: string;
  reason: string;
  note: string | null;
  createdAt: string;
  reporterName: string | null;
  offerId: string;
  offerUrl: string;
  offerPrice: number | null;
  retailer: string;
  productTitle: string;
  productSlug: string;
  offerGtin: string | null;
  productGtin: string | null;
  gtinMismatch: boolean;
}

export interface ConflictRow {
  productId: string;
  productTitle: string;
  productSlug: string;
  conflictKey: string;
  offers: { id: string; url: string; gtin: string | null; price: number | null; retailer: string; counts: boolean }[];
}

export interface ProductReportRow {
  id: string;
  kind: string;
  note: string | null;
  createdAt: string;
  reporterName: string | null;
  productTitle: string;
  productSlug: string;
  productPrice: number | null;
}

const REASON_LABEL: Record<string, string> = {
  WRONG_PRODUCT: "Fel produkt",
  WRONG_PRICE: "Fel pris",
  DEAD_LINK: "Död länk",
  OUT_OF_STOCK: "Slutsåld",
};

const KIND_LABEL: Record<string, string> = {
  WRONG_PRICE: "Fel pris",
  WRONG_IMAGE: "Fel bild",
  WRONG_INFO: "Fel kortinfo",
  DUPLICATE: "Dubblett",
  OTHER: "Annat",
};

export function LinkReportsClient({
  reports,
  conflicts,
  productReports = [],
}: {
  reports: OfferReportRow[];
  conflicts: ConflictRow[];
  productReports?: ProductReportRow[];
}) {
  const [closed, setClosed] = useState<Map<string, string>>(new Map());

  async function closeReport(id: string, status: "ACTIONED" | "DISMISSED") {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/product-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setClosed((m) => new Map(m).set(id, status));
    } catch {
      alert("Kunde inte uppdatera anmälan.");
    } finally {
      setBusy(null);
    }
  }
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [ackedProducts, setAckedProducts] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  async function deleteOffer(offerId: string) {
    if (!confirm("Ta bort denna butikslänk permanent? (rättas mot rådata, offern raderas via ID)")) return;
    setBusy(offerId);
    try {
      const res = await fetch(`/api/admin/offers/${offerId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setGone((g) => new Set(g).add(offerId));
    } catch {
      alert("Kunde inte ta bort erbjudandet.");
    } finally {
      setBusy(null);
    }
  }

  async function ackConflict(productId: string) {
    setBusy(productId);
    try {
      const res = await fetch(`/api/admin/gtin-conflicts/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setAckedProducts((s) => new Set(s).add(productId));
    } catch {
      alert("Kunde inte kvittera konflikten.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">Felaktiga butikslänkar</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Streckkoderna visas sida vid sida. Skiljer de sig åt bär butikens sida en{" "}
          <strong>annan tillverkarkod</strong> än produkten vi visar. Då är länken fel och behöver ingen
          bedömning. Rättas genom att radera offern (rådata), aldrig genom att lappa priset.
        </p>
      </header>

      {/* ---- "Något fel?" om själva produkten ---- */}
      <section>
        <h2 className="mb-3 text-lg font-medium">
          Fel på produkten <span className="text-ink-muted">({productReports.length})</span>
        </h2>
        {productReports.length === 0 ? (
          <p className="rounded-lg border border-surface-border p-4 text-sm text-ink-muted">Inga öppna anmälningar.</p>
        ) : (
          <ul className="space-y-3">
            {productReports.map((r) => (
              <li
                key={r.id}
                className={`rounded-xl border border-surface-border p-4 ${closed.has(r.id) ? "opacity-40" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-md bg-surface-overlay px-2 py-0.5 font-medium">{KIND_LABEL[r.kind] ?? r.kind}</span>
                  <Link href={`/produkter/${r.productSlug}`} className="hover:text-holo-cyan">
                    {r.productTitle}
                  </Link>
                  <span className="tabular-nums text-ink-muted">{formatPrice(r.productPrice)}</span>
                  <span className="ml-auto text-xs text-ink-muted">
                    {r.reporterName ?? "anonym"} · {new Date(r.createdAt).toLocaleDateString("sv-SE")}
                  </span>
                </div>
                {r.note && <p className="mt-2 text-sm text-ink-muted">”{r.note}”</p>}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy === r.id || closed.has(r.id)}
                    onClick={() => closeReport(r.id, "ACTIONED")}
                    className="rounded-md border border-holo-cyan/40 px-3 py-1 text-xs font-medium text-holo-cyan hover:bg-holo-cyan/10 disabled:opacity-50"
                  >
                    {closed.get(r.id) === "ACTIONED" ? "Åtgärdad ✓" : "Åtgärdad"}
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id || closed.has(r.id)}
                    onClick={() => closeReport(r.id, "DISMISSED")}
                    className="rounded-md border border-surface-border px-3 py-1 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-50"
                  >
                    {closed.get(r.id) === "DISMISSED" ? "Avfärdad" : "Avfärda"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Anmält av användare ---- */}
      <section>
        <h2 className="mb-3 text-lg font-medium">
          Anmält av användare <span className="text-ink-muted">({reports.length})</span>
        </h2>
        {reports.length === 0 ? (
          <p className="rounded-lg border border-surface-border p-4 text-sm text-ink-muted">
            Inga öppna anmälningar.
          </p>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li
                key={r.id}
                className={`rounded-xl border p-4 ${
                  r.gtinMismatch ? "border-fall/50 bg-fall/5" : "border-surface-border"
                } ${gone.has(r.offerId) ? "opacity-40" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-md bg-surface-overlay px-2 py-0.5 font-medium">
                    {REASON_LABEL[r.reason] ?? r.reason}
                  </span>
                  <span className="text-ink-muted">{r.retailer}</span>
                  {r.gtinMismatch && (
                    <span className="rounded-md bg-fall/20 px-2 py-0.5 text-xs font-semibold text-fall">
                      STRECKKODERNA SKILJER SIG: bevisad felmatch
                    </span>
                  )}
                  <span className="ml-auto text-xs text-ink-muted">
                    {r.reporterName ?? "anonym"} · {new Date(r.createdAt).toLocaleDateString("sv-SE")}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-ink-muted">Vår produkt</div>
                    <Link href={`/produkter/${r.productSlug}`} className="text-sm hover:text-holo-cyan">
                      {r.productTitle}
                    </Link>
                    <div className="mt-1 font-mono text-xs text-ink-muted">{r.productGtin ?? "ingen kod"}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-ink-muted">Butikens sida</div>
                    <a
                      href={r.offerUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="break-all text-sm hover:text-holo-cyan"
                    >
                      {r.offerUrl}
                    </a>
                    <div className="mt-1 font-mono text-xs text-ink-muted">{r.offerGtin ?? "ingen kod"}</div>
                  </div>
                </div>

                {r.note && <p className="mt-2 text-sm text-ink-muted">”{r.note}”</p>}

                <div className="mt-3 flex items-center gap-3">
                  <span className="text-sm tabular-nums">
                    {r.offerPrice != null ? formatPrice(r.offerPrice) : "–"}
                  </span>
                  <button
                    type="button"
                    disabled={busy === r.offerId || gone.has(r.offerId)}
                    onClick={() => deleteOffer(r.offerId)}
                    className="rounded-md border border-fall/40 px-3 py-1 text-xs font-medium text-fall transition-colors hover:bg-fall/10 disabled:opacity-50"
                  >
                    {gone.has(r.offerId) ? "Borttagen" : busy === r.offerId ? "Tar bort…" : "Ta bort länken"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Hittat av streckkoden, utan att någon anmält ---- */}
      <section>
        <h2 className="mb-1 text-lg font-medium">
          Hittade av streckkoden <span className="text-ink-muted">({conflicts.length})</span>
        </h2>
        <p className="mb-3 text-sm text-ink-muted">
          Produkter vars butikslänkar bär <strong>motstridiga</strong> tillverkarkoder. Distributör-EAN och
          koder som delas mellan flera produkter räknas <strong>inte</strong> (visas gråade). Är alla länkar rätt
          (t.ex. reprint/v2 med egen kod) — <strong>Markera OK</strong>; konflikten döljs tills en ny avvikande kod dyker upp.
        </p>
        {conflicts.filter((c) => !ackedProducts.has(c.productId)).length === 0 ? (
          <p className="rounded-lg border border-surface-border p-4 text-sm text-ink-muted">
            Inga konflikter. 🎉
          </p>
        ) : (
          <ul className="space-y-3">
            {conflicts.map((c) => (
              <li
                key={c.productId}
                className={`rounded-xl border border-surface-border p-4 ${ackedProducts.has(c.productId) ? "opacity-40" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/produkter/${c.productSlug}`} className="text-sm font-medium hover:text-holo-cyan">
                    {c.productTitle}
                  </Link>
                  <button
                    type="button"
                    disabled={busy === c.productId || ackedProducts.has(c.productId)}
                    onClick={() => ackConflict(c.productId)}
                    className="ml-auto rounded-md border border-holo-cyan/40 px-2.5 py-0.5 text-xs font-medium text-holo-cyan transition-colors hover:bg-holo-cyan/10 disabled:opacity-50"
                  >
                    {ackedProducts.has(c.productId) ? "Kvitterad ✓" : busy === c.productId ? "…" : "Markera OK"}
                  </button>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {c.offers.map((o) => (
                    <li
                      key={o.id}
                      className={`flex flex-wrap items-center gap-3 text-xs ${
                        gone.has(o.id) ? "opacity-40" : ""
                      }`}
                    >
                      <span
                        className={`w-32 shrink-0 font-mono ${o.counts ? "text-ink-muted" : "text-ink-muted/40 line-through"}`}
                        title={o.counts ? undefined : "Räknas inte (distributör-EAN eller delad sortimentskod)"}
                      >
                        {o.gtin}
                      </span>
                      <span className="w-28 shrink-0">{o.retailer}</span>
                      <a
                        href={o.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="min-w-0 flex-1 truncate text-ink-muted hover:text-holo-cyan"
                      >
                        {o.url}
                      </a>
                      <button
                        type="button"
                        disabled={busy === o.id || gone.has(o.id)}
                        onClick={() => deleteOffer(o.id)}
                        className="rounded-md border border-fall/40 px-2 py-0.5 font-medium text-fall transition-colors hover:bg-fall/10 disabled:opacity-50"
                      >
                        {gone.has(o.id) ? "Borttagen" : busy === o.id ? "…" : "Ta bort"}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
