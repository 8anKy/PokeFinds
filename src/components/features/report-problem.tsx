"use client";

/**
 * "Något fel?" på produktsidan (ägarbeslut 2026-10-16). EN knapp per produkt — inte en per
 * butiksrad (den togs bort 2026-07-17 för att den skräpade ned listan). Arket frågar VAD som
 * är fel; väljer man en butiks annons pekar man ut butiken och vad som är fel med den.
 *
 * Butiksfel ⇒ `OfferReport` (admin → Länkfel, rättas mot offern). Övrigt ⇒ `ProductReport`.
 * Fungerar utloggad, precis som rutterna.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { BottomSheet, BottomSheetCta } from "@/components/ui/bottom-sheet";
import { useLiveOffers } from "@/components/features/live-product-pricing";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type Kind = "WRONG_PRICE" | "STORE" | "WRONG_IMAGE" | "WRONG_INFO" | "DUPLICATE" | "OTHER";
type StoreReason = "WRONG_PRODUCT" | "WRONG_PRICE" | "DEAD_LINK" | "OUT_OF_STOCK";

const KINDS: Kind[] = ["WRONG_PRICE", "STORE", "WRONG_IMAGE", "WRONG_INFO", "DUPLICATE", "OTHER"];
const STORE_REASONS: StoreReason[] = ["WRONG_PRODUCT", "WRONG_PRICE", "DEAD_LINK", "OUT_OF_STOCK"];

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left text-sm transition-colors",
        active ? "border-holo-cyan bg-holo-cyan/10 text-ink" : "border-surface-border text-ink-muted hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

export function ReportProblem({ slug }: { slug: string }) {
  const t = useTranslations("Report");
  const offers = useLiveOffers();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [storeReason, setStoreReason] = useState<StoreReason | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  function reset() {
    setKind(null);
    setOfferId(null);
    setStoreReason(null);
    setNote("");
    setState("idle");
  }

  function close() {
    setOpen(false);
    // Låt arket glida ned innan innehållet nollas.
    setTimeout(reset, 300);
  }

  const ready = kind != null && (kind !== "STORE" || (offerId != null && storeReason != null));

  async function send() {
    if (!ready || state === "sending") return;
    setState("sending");
    const url = kind === "STORE" ? `/api/offers/${offerId}/report` : `/api/products/${encodeURIComponent(slug)}/report`;
    const body =
      kind === "STORE"
        ? { reason: storeReason, note: note.trim() || undefined }
        : { kind, note: note.trim() || undefined };
    try {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 text-sm text-ink-muted underline-offset-4 hover:text-holo-cyan hover:underline"
      >
        {t("button")}
      </button>

      <BottomSheet
        open={open}
        title={state === "done" ? t("doneTitle") : t("title")}
        onClose={close}
        closeLabel={t("close")}
        panelClassName="sm:mx-auto sm:max-w-md"
        footer={
          state === "done" ? (
            <BottomSheetCta onClick={close}>{t("close")}</BottomSheetCta>
          ) : (
            <BottomSheetCta onClick={send} disabled={!ready || state === "sending"}>
              {state === "sending" ? t("sending") : t("send")}
            </BottomSheetCta>
          )
        }
      >
        {state === "done" ? (
          <p className="pb-2 text-sm text-ink-muted">{t("doneBody")}</p>
        ) : (
          <div className="space-y-5 pb-2">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("whatQuestion")}</p>
              {KINDS.filter((k) => k !== "STORE" || offers.length > 0).map((k) => (
                <Choice
                  key={k}
                  active={kind === k}
                  onClick={() => {
                    setKind(k);
                    if (k !== "STORE") {
                      setOfferId(null);
                      setStoreReason(null);
                    }
                  }}
                >
                  <span>
                    <span className="block font-medium text-ink">{t(`kind.${k}`)}</span>
                    <span className="block text-xs text-ink-faint">{t(`kindHint.${k}`)}</span>
                  </span>
                </Choice>
              ))}
            </div>

            {kind === "STORE" && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("whichStore")}</p>
                {offers.map((o) => (
                  <Choice key={o.id} active={offerId === o.id} onClick={() => setOfferId(o.id)}>
                    <span className="truncate font-medium text-ink">{o.retailer.name}</span>
                    <span className="shrink-0 tabular-nums text-ink-muted">{formatPrice(o.price)}</span>
                  </Choice>
                ))}
              </div>
            )}

            {kind === "STORE" && offerId && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("storeQuestion")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {STORE_REASONS.map((r) => (
                    <Choice key={r} active={storeReason === r} onClick={() => setStoreReason(r)}>
                      <span className="font-medium">{t(`storeReason.${r}`)}</span>
                    </Choice>
                  ))}
                </div>
              </div>
            )}

            {kind && (
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("noteLabel")}</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 500))}
                  rows={3}
                  placeholder={t("notePlaceholder")}
                  className="mt-2 w-full resize-none rounded-xl border border-surface-border bg-surface px-3.5 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-holo-cyan focus:outline-none"
                />
              </label>
            )}

            {state === "error" && <p className="text-sm text-fall">{t("error")}</p>}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
