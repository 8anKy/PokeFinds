"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { IconBell, IconPackage, IconPlus } from "@/components/ui/icons";

export interface ProductActionsProps {
  productId: string;
  title: string;
}

type ActionKey = "price" | "restock" | "collection";

export function ProductActions({ productId, title }: ProductActionsProps) {
  const t = useTranslations("Detail");
  const tc = useTranslations("Common");
  const [loading, setLoading] = useState<ActionKey | null>(null);
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [targetValue, setTargetValue] = useState("");
  const [alreadyWatched, setAlreadyWatched] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  // Är produkten redan i bevakningarna? Rå fetch (inte apiFetch) så en utloggad
  // besökare inte slängs till login av 401 på denna passiva koll.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/watchlist", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: { product?: { id?: string } }[] } | null) => {
        if (cancelled || !d?.items) return;
        setAlreadyWatched(d.items.some((it) => it.product?.id === productId));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [productId]);

  function openPriceWatch() {
    if (alreadyWatched) {
      toast({
        title: t("alreadyWatching"),
        description: t("alreadyWatchingDesc"),
      });
      return;
    }
    setPriceModalOpen(true);
  }

  async function post(
    key: ActionKey,
    url: string,
    body: Record<string, unknown>,
    successTitle: string
  ) {
    setLoading(key);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        router.push("/logga-in");
        return;
      }
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        toast({
          title: t("actionFailed"),
          description: data.error ?? t("tryAgain"),
          variant: "error",
        });
        return;
      }
      toast({ title: successTitle, variant: "success" });
    } catch {
      toast({ title: t("tryAgain"), variant: "error" });
    } finally {
      setLoading(null);
    }
  }

  async function savePriceWatch() {
    const trimmed = targetValue.trim();
    let targetPrice: number | undefined;
    if (trimmed) {
      const kr = Number(trimmed.replace(",", "."));
      if (!Number.isFinite(kr) || kr < 0) {
        toast({ title: t("invalidPrice"), description: t("invalidPriceDesc"), variant: "error" });
        return;
      }
      targetPrice = Math.round(kr * 100);
    }
    setPriceModalOpen(false);
    await post(
      "price",
      "/api/watchlist",
      { productId, priceAlert: true, ...(targetPrice != null ? { targetPrice } : {}) },
      t("priceWatchCreated")
    );
    setTargetValue("");
    setAlreadyWatched(true);
  }

  return (
    <>
    <div className="flex flex-wrap gap-2">
      <Button loading={loading === "price"} onClick={openPriceWatch}>
        <IconBell size={16} />
        {t("watchPrice")}
      </Button>
      <Button
        variant="secondary"
        loading={loading === "restock"}
        onClick={() =>
          post(
            "restock",
            "/api/watchlist",
            { productId, restockAlert: true },
            t("restockWatchCreated")
          )
        }
      >
        <IconPackage size={16} />
        {t("watchRestock")}
      </Button>
      <Button
        variant="secondary"
        loading={loading === "collection"}
        onClick={() =>
          post(
            "collection",
            "/api/collection",
            { productId, quantity: 1 },
            t("addedToCollection")
          )
        }
      >
        <IconPlus size={16} />
        {t("addToCollection")}
      </Button>
    </div>

      <Modal
        open={priceModalOpen}
        onClose={() => setPriceModalOpen(false)}
        title={t("watchPrice")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPriceModalOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => void savePriceWatch()} loading={loading === "price"}>
              {t("watchCta")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void savePriceWatch();
          }}
        >
          <p className="mb-4 text-sm text-ink-muted">
            {t.rich("priceModalIntro", {
              b: (c) => <span className="font-medium text-ink">{c}</span>,
              title,
            })}
          </p>
          <Label htmlFor="watchTargetPrice">{t("targetPriceLabel")}</Label>
          <Input
            id="watchTargetPrice"
            inputMode="decimal"
            placeholder={t("targetPricePlaceholder")}
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            autoFocus
          />
        </form>
      </Modal>
    </>
  );
}
