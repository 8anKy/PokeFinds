"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client-api";
import { alertCopyKey } from "@/lib/alert-copy";
import { priceAlertsPausedClient } from "@/lib/price-alerts-pause";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BottomSheet, BottomSheetCta } from "@/components/ui/bottom-sheet";
import { Input, Label, Checkbox } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { SafeImage } from "@/components/ui/safe-image";
import { IconCards, IconPackage } from "@/components/ui/icons";
import { ProTextLink } from "@/components/features/pro-cta";

export interface WatchlistRow {
  id: string;
  targetPrice: number | null; // öre
  restockAlert: boolean;
  priceAlert: boolean;
  isPaused: boolean;
  product: {
    id: string;
    title: string;
    slug: string;
    imageUrl: string | null;
    category: string;
    lowestPrice: number | null; // öre
    setName: string | null;
  };
}

/**
 * Radminiatyr, delad av mobil- och desktopvyn.
 *
 * FAST 5/7-ruta (kortformatet) för ALLA produkter, inte per kategori: sealed-
 * bilder är liggande, och en egen proportion per rad hade gett olika höga rutor
 * → texten började på olika höjd och listan fick en ojämn kant. `object-contain`
 * lägger i stället en box i brevlådeformat i rutan.
 *
 * Ingen grå platta bakom bilden: ytan är svart och `surface-overlay` lyser som
 * ett hål på den (samma skäl som bildbrunnen i product-card.tsx) — hårlinjen
 * räcker som avgränsning. `SafeImage` är golvet mot döda CDN-URL:er.
 */
function RowThumb({
  product,
  className,
}: {
  product: WatchlistRow["product"];
  className?: string;
}) {
  const Icon = product.category === "SINGLE_CARD" ? IconCards : IconPackage;
  return (
    <span
      className={cn(
        "block aspect-[5/7] shrink-0 overflow-hidden rounded-md bg-surface ring-1 ring-surface-border",
        className
      )}
    >
      <SafeImage
        src={product.imageUrl}
        // Tom alt: produktnamnet står som text direkt bredvid, så en alt-text
        // hade lästs upp två gånger av skärmläsaren.
        alt=""
        className="h-full w-full object-contain"
        fallback={
          <span
            className="flex h-full w-full items-center justify-center text-ink-faint"
            aria-hidden="true"
          >
            <Icon size={16} />
          </span>
        }
      />
    </span>
  );
}

function oreToKrInput(ore: number | null): string {
  return ore == null ? "" : String(ore / 100).replace(".", ",");
}

function krInputToOre(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const kr = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(kr) || kr < 0) return null;
  return Math.round(kr * 100);
}

export function WatchlistTable({
  initialItems,
  isPro,
  restockPaused,
}: {
  initialItems: WatchlistRow[];
  isPro: boolean;
  /** Restock-larmen avstängda → reglaget låses och visas som pausat. */
  restockPaused: boolean;
}) {
  const t = useTranslations("Watchlist");
  const tc = useTranslations("Common");
  const tPause = useTranslations("RestockPause");
  // ⛔ LÄSES HÄR, INTE SOM PROP. Prislarmen pausades 2026-08-26 och den här tabellen
  // är en klientkomponent — flaggan finns redan i bundlen via speglingen i
  // next.config.mjs, och en extra prop hade betytt att varje NYTT anropsställe måste
  // minnas att skicka den. Restock-flaggan är prop av historiska skäl (servern läser
  // den redan på en force-dynamic-sida); blanda inte ihop dem.
  const pricePaused = priceAlertsPausedClient();
  const [items, setItems] = useState(initialItems);
  const [editing, setEditing] = useState<WatchlistRow | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  async function patchItem(id: string, body: Record<string, unknown>, successTitle: string) {
    setBusyId(id);
    try {
      const updated = await apiFetch<WatchlistRow & { product: { offers?: unknown } }>(
        `/api/watchlist/${id}`,
        { method: "PATCH", body }
      );
      setItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? {
                ...it,
                targetPrice: updated.targetPrice ?? null,
                restockAlert: updated.restockAlert,
                priceAlert: updated.priceAlert,
                isPaused: updated.isPaused,
              }
            : it
        )
      );
      toast({ title: successTitle, variant: "success" });
    } catch (e) {
      toast({
        title: t("updateFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  function openEdit(item: WatchlistRow) {
    setEditing(item);
    setEditValue(oreToKrInput(item.targetPrice));
  }

  async function saveTargetPrice() {
    if (!editing) return;
    const ore = krInputToOre(editValue);
    if (editValue.trim() && ore == null) {
      toast({ title: t("invalidPrice"), description: t("invalidPriceDesc"), variant: "error" });
      return;
    }
    setSaving(true);
    await patchItem(editing.id, { targetPrice: ore }, t("targetSaved"));
    setSaving(false);
    setEditing(null);
  }

  /**
   * ETT TRYCK TAR BORT (ägarbeslut 2026-09-07: "man ska inte behöva trycka igen").
   *
   * Bekräftelsedialogen är utbytt mot ÅNGRA i toasten — samma säkerhetsnät som
   * "+"-knappen i produktkortet fick, och samma skäl: dialogen kostade ett tryck
   * i det normala fallet för att skydda mot det ovanliga. Raden försvinner
   * optimistiskt och läggs tillbaka på SIN plats om servern säger nej, annars
   * ljuger listan om vad som faktiskt finns.
   */
  async function removeWatch(item: WatchlistRow) {
    const index = items.findIndex((it) => it.id === item.id);
    setItems((prev) => prev.filter((it) => it.id !== item.id));
    try {
      await apiFetch(`/api/watchlist/${item.id}`, { method: "DELETE" });
      router.refresh();
      toast({
        title: t("removed"),
        variant: "success",
        action: { label: tc("undo"), onClick: () => void undoRemove(item, index) },
      });
    } catch (e) {
      restoreRow(item, index);
      toast({
        title: t("removeFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    }
  }

  function restoreRow(item: WatchlistRow, index: number) {
    setItems((prev) => {
      if (prev.some((it) => it.product.id === item.product.id)) return prev;
      const next = [...prev];
      next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
      return next;
    });
  }

  async function undoRemove(item: WatchlistRow, index: number) {
    try {
      const restored = await apiFetch<{ id: string }>("/api/watchlist", {
        method: "POST",
        body: {
          productId: item.product.id,
          ...(item.targetPrice != null ? { targetPrice: item.targetPrice } : {}),
          restockAlert: item.restockAlert,
          priceAlert: item.priceAlert,
        },
      });
      // Pausläget finns inte i POST-schemat — utan den här raden vaknar en pausad
      // bevakning till liv av ett ångra, och börjar larma om något användaren
      // medvetet tystat.
      if (item.isPaused) {
        await apiFetch(`/api/watchlist/${restored.id}`, {
          method: "PATCH",
          body: { isPaused: true },
        });
      }
      restoreRow({ ...item, id: restored.id }, index);
      router.refresh();
      toast({ title: t("restored"), variant: "success" });
    } catch (e) {
      toast({
        title: t("restoreFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    }
  }

  const actionButtons = (item: WatchlistRow) => (
    <>
      <Button size="sm" variant="ghost" onClick={() => openEdit(item)}>
        {tc("edit")}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        loading={busyId === item.id}
        onClick={() =>
          void patchItem(
            item.id,
            { isPaused: !item.isPaused },
            item.isPaused ? t("resumed") : t("pausedToast")
          )
        }
      >
        {item.isPaused ? t("resume") : t("pause")}
      </Button>
      <Button size="sm" variant="danger" onClick={() => void removeWatch(item)}>
        {tc("delete")}
      </Button>
    </>
  );

  return (
    <>
      {/* Gratiskonto: larm avfyras aldrig (Pro-förmån) → vaddera INTE larmet som
          aktivt. Visa upsell + inaktivera reglagen nedan. */}
      {/* Under pausen säger RestockPausedBanner ovanför redan allt — den här rutans
          pausvariant var en andra banner med samma budskap (QA 2026-09-05). */}
      {!isPro && !restockPaused && !pricePaused && (
        <div className="mb-4 rounded-lg border border-holo-cyan/30 bg-holo-cyan/5 px-4 py-3 text-sm text-ink-muted">
          {t.rich(alertCopyKey("freeAlertsBanner", pricePaused), {
            link: (c) => (
              <ProTextLink source="watchlist-banner" className="font-medium text-holo-cyan hover:underline">
                {c}
              </ProTextLink>
            ),
          })}
        </div>
      )}
      {/* Mobil: kort-layout — tabellen tvingar horisontell scroll på liten skärm. */}
      <div className="space-y-3 lg:hidden">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "rounded-xl border border-surface-border bg-surface-raised/40 p-4",
              item.isPaused && "opacity-60"
            )}
          >
            {/* `min-w-0 flex-1` på textkolumnen + `shrink-0` på miniatyr och
                badge: utan dem trycker en lång titel ut raden och kortet skjuter
                utanför viewporten vid 360px. */}
            <div className="flex items-start gap-3">
              <RowThumb product={item.product} className="w-12" />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/produkter/${item.product.slug}`}
                  className="break-words font-medium text-ink transition-colors hover:text-holo-cyan"
                >
                  {item.product.title}
                </Link>
                {item.product.setName && (
                  <p className="text-xs text-ink-muted">{item.product.setName}</p>
                )}
              </div>
              {item.isPaused ? (
                <Badge variant="warning" className="shrink-0">
                  {t("paused")}
                </Badge>
              ) : (
                <Badge variant="success" className="shrink-0">
                  {t("active")}
                </Badge>
              )}
            </div>

            <div className="mt-3 flex gap-6 text-sm">
              <div>
                <p className="text-xs text-ink-muted">{t("lowestNow")}</p>
                <p data-price className="font-semibold text-ink">
                  {formatPrice(item.product.lowestPrice)}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">{t("target")}</p>
                <p data-price className="font-semibold text-ink">
                  {item.targetPrice != null ? formatPrice(item.targetPrice) : "–"}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-col items-start gap-2">
              <label className="flex items-center gap-2 text-sm text-ink">
                <Checkbox
                  checked={isPro && !restockPaused && item.restockAlert}
                  disabled={busyId === item.id || !isPro || restockPaused}
                  onChange={(e) =>
                    void patchItem(
                      item.id,
                      { restockAlert: e.target.checked },
                      e.target.checked ? t("restockOn") : t("restockOff")
                    )
                  }
                />
                {t("restockLabel")}
                {restockPaused && (
                  <span className="text-xs text-holo-gold">{tPause("tag")}</span>
                )}
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <Checkbox
                  checked={isPro && !pricePaused && item.priceAlert}
                  disabled={busyId === item.id || !isPro || pricePaused}
                  onChange={(e) =>
                    void patchItem(
                      item.id,
                      { priceAlert: e.target.checked },
                      e.target.checked ? t("priceOn") : t("priceOff")
                    )
                  }
                />
                {t("priceLabel")}
                {pricePaused && (
                  <span className="text-xs text-holo-gold">{tPause("tag")}</span>
                )}
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">{actionButtons(item)}</div>
          </div>
        ))}
      </div>

      {/* Desktop: full tabell. */}
      <div className="hidden lg:block">
      <Table>
        <THead>
          <TR>
            <TH>{t("colProduct")}</TH>
            <TH>{t("colLowest")}</TH>
            <TH>{t("colTarget")}</TH>
            <TH>
              {t("colRestock")}
              {restockPaused && (
                <span className="ml-1 text-xs font-normal text-holo-gold">{tPause("tag")}</span>
              )}
            </TH>
            <TH>
              {t("colPriceAlert")}
              {pricePaused && (
                <span className="ml-1 text-xs font-normal text-holo-gold">{tPause("tag")}</span>
              )}
            </TH>
            <TH>{t("colStatus")}</TH>
            <TH className="text-right">{t("colActions")}</TH>
          </TR>
        </THead>
        <TBody>
          {items.map((item) => (
            <TR key={item.id} className={item.isPaused ? "opacity-60" : undefined}>
              <TD>
                <div className="flex items-center gap-3">
                  <RowThumb product={item.product} className="w-9" />
                  <div className="min-w-0">
                    <Link
                      href={`/produkter/${item.product.slug}`}
                      className="font-medium text-ink transition-colors hover:text-holo-cyan"
                    >
                      {item.product.title}
                    </Link>
                    {item.product.setName && (
                      <p className="text-xs text-ink-muted">{item.product.setName}</p>
                    )}
                  </div>
                </div>
              </TD>
              <TD data-price className="font-semibold">
                {formatPrice(item.product.lowestPrice)}
              </TD>
              <TD data-price>{item.targetPrice != null ? formatPrice(item.targetPrice) : "–"}</TD>
              <TD>
                <Checkbox
                  checked={isPro && !restockPaused && item.restockAlert}
                  disabled={busyId === item.id || !isPro || restockPaused}
                  aria-label={t("restockAria", { title: item.product.title })}
                  onChange={(e) =>
                    void patchItem(
                      item.id,
                      { restockAlert: e.target.checked },
                      e.target.checked ? t("restockOn") : t("restockOff")
                    )
                  }
                />
              </TD>
              <TD>
                <Checkbox
                  checked={isPro && !pricePaused && item.priceAlert}
                  disabled={busyId === item.id || !isPro || pricePaused}
                  aria-label={t("priceAria", { title: item.product.title })}
                  onChange={(e) =>
                    void patchItem(
                      item.id,
                      { priceAlert: e.target.checked },
                      e.target.checked ? t("priceOn") : t("priceOff")
                    )
                  }
                />
              </TD>
              <TD>
                {item.isPaused ? (
                  <Badge variant="warning">{t("paused")}</Badge>
                ) : (
                  <Badge variant="success">{t("active")}</Badge>
                )}
              </TD>
              <TD>
                <div className="flex justify-end gap-2">{actionButtons(item)}</div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      </div>

      {/* Redigera målpris — BOTTENARK, inte modal (ägarbeslut 2026-09-07).
          `ui/bottom-sheet.tsx` är appens enda glid-upp-panel och äger
          tangentbordslyftet; prisfältet öppnar sifferknappsatsen, så en egen
          modal här hade behövt lösa samma sak en gång till. */}
      <BottomSheet
        open={editing != null}
        title={t("editTarget")}
        onClose={() => setEditing(null)}
        closeLabel={tc("cancel")}
        panelClassName="sm:mx-auto sm:max-w-md"
        footer={
          <BottomSheetCta onClick={() => void saveTargetPrice()} disabled={saving}>
            {tc("save")}
          </BottomSheetCta>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveTargetPrice();
          }}
        >
          <p className="mb-4 text-sm text-ink-muted">
            {t.rich(alertCopyKey("editHint", pricePaused), {
              title: editing?.product.title ?? "",
              b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
            })}
          </p>
          {/* ⛔ INGEN autoFocus. Tangentbordet öppnades då i samma commit som arket
              monterades — Capacitor-lyssnaren i useKeyboardHeight registreras
              asynkront, så `keyboardWillShow` hann fyra innan den fanns och arket
              lyftes aldrig: knappsatsen låg rakt över fältet (rapporterat
              2026-09-07). Fokus i ett nyss öppnat ark fick dessutom sidan bakom
              att scrolla till fältet. Samma val som snabbtilläggets ark. */}
          <Label htmlFor="targetPrice">{t("targetPriceLabel")}</Label>
          <Input
            id="targetPrice"
            inputMode="decimal"
            enterKeyHint="done"
            placeholder={t("targetPlaceholder")}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="h-11 bg-surface"
          />
        </form>
      </BottomSheet>

    </>
  );
}
