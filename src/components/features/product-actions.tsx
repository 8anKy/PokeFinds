"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getSharedSession } from "@/lib/client-session";
import { useRouter } from "@/i18n/navigation";
import { hasAuthHint } from "@/lib/auth-hint";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { IconBell, IconPackage, IconPlus } from "@/components/ui/icons";
import { DiscordRestockTip } from "@/components/features/discord-restock-tip";
import { alertCopyKey } from "@/lib/alert-copy";
import { priceAlertsPausedClient } from "@/lib/price-alerts-pause";
import { restockAlertsPausedClient } from "@/lib/restock-alerts-pause";
import { ProTextLink } from "@/components/features/pro-cta";

export interface ProductActionsProps {
  productId: string;
  title: string;
}

type ActionKey = "price" | "restock" | "collection";

/** Mobil: full bredd i sin rutnätscell, 48 px hög, text 15. Desktop: knappens vanliga md-mått. */
const ACTION_CLASS = "h-12 w-full px-3 text-[15px] sm:h-10 sm:w-auto sm:px-4 sm:text-sm";

export function ProductActions({ productId, title }: ProductActionsProps) {
  const t = useTranslations("Detail");
  const tc = useTranslations("Common");
  const [loading, setLoading] = useState<ActionKey | null>(null);
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [targetValue, setTargetValue] = useState("");
  const [alreadyWatched, setAlreadyWatched] = useState(false);
  // Bevakning skapad HÄR OCH NU (inte "bevakas sedan tidigare") → Discord-tipset.
  // ⛔ Grinda den aldrig på `alreadyWatched`: då hade skylten suttit kvar på varje
  // besök hos varje bevakad produkt, vilket är tjat och inte ett tips.
  const [justWatched, setJustWatched] = useState(false);
  // null = okänt (utloggad/laddar) → visa standard-knapparna; false = gratiskonto
  // (larm avfyras aldrig → erbjud "spara" + upsell istället för larm-knappar).
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const restockPaused = restockAlertsPausedClient();
  // Prislarmen har en EGEN paus (2026-08-26) — se price-alerts-pause.ts.
  const pricePaused = priceAlertsPausedClient();

  // Läs plan klient-sida (produktsidan ISR-cachas → ingen server-auth). Bara om
  // fo_auth-cookien finns, så utloggade aldrig träffar /api/auth/session.
  useEffect(() => {
    if (!hasAuthHint()) return;
    void getSharedSession().then((s) => setIsPro(!!s?.user?.isPro));
  }, []);

  // Är produkten redan i bevakningarna? Rå fetch (inte apiFetch) så en utloggad
  // besökare inte slängs till login av 401 på denna passiva koll.
  useEffect(() => {
    // Samma grind som plan-läsningen ovan: utan den blev det en garanterad
    // Neon-väckning per produktvisning för varje inloggad besökare (401:an är
    // gratis för utloggade, men den inloggade vägen träffar databasen).
    if (!hasAuthHint()) return;
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

  /** Returnerar true bara när servern faktiskt skapade posten — Discord-tipset
   *  hänger på det, och ett tips efter ett misslyckat anrop hade läst som att
   *  bevakningen gick igenom. */
  async function post(
    key: ActionKey,
    url: string,
    body: Record<string, unknown>,
    successTitle: string
  ): Promise<boolean> {
    setLoading(key);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        router.push("/logga-in");
        return false;
      }
      if (!res.ok) {
        // Servern svarar med svenska felmeddelanden → visa ALDRIG data.error rått
        // (läcker svenska i EN-läget). 409 = redan bevakad → lokaliserat meddelande.
        if (res.status === 409) {
          toast({ title: t("alreadyWatching"), description: t("alreadyWatchingDesc") });
          return false;
        }
        toast({ title: t("actionFailed"), description: t("tryAgain"), variant: "error" });
        return false;
      }
      toast({ title: successTitle, variant: "success" });
      return true;
    } catch {
      toast({ title: t("tryAgain"), variant: "error" });
      return false;
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
    const ok = await post(
      "price",
      "/api/watchlist",
      { productId, priceAlert: true, ...(targetPrice != null ? { targetPrice } : {}) },
      t("priceWatchCreated")
    );
    setTargetValue("");
    setAlreadyWatched(true);
    if (ok) setJustWatched(true);
  }

  async function saveCollection() {
    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty < 1) {
      toast({ title: t("invalidPrice"), description: t("tryAgain"), variant: "error" });
      return;
    }
    setCollectionModalOpen(false);
    await post("collection", "/api/collection", { productId, quantity: qty }, t("addedToCollection"));
    setQuantity("1");
  }

  // Gratiskonto: larm är en Pro-förmån → spara produkten UTAN larmflaggor (ren
  // bevakningslista) istället för att låtsas skapa ett larm som aldrig avfyras.
  function saveWatch() {
    if (alreadyWatched) {
      toast({ title: t("alreadyWatching"), description: t("alreadyWatchingDesc") });
      return;
    }
    void post(
      "price",
      "/api/watchlist",
      { productId, priceAlert: false, restockAlert: false },
      t("savedToWatchlist")
    ).then((ok) => ok && setJustWatched(true));
    setAlreadyWatched(true);
  }

  return (
    <>
    {/* Mobil: två lika breda knappar i arket (48 px höga — tumvänligt); en
        eventuell tredje (restock, när pausen hävs) får hela nästa rad. Desktop:
        raden som förut. */}
    <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
      {isPro === false ? (
        <Button loading={loading === "price"} onClick={saveWatch} className={ACTION_CLASS}>
          <IconBell size={16} />
          {t("saveToWatchlist")}
        </Button>
      ) : (
        <>
          <Button loading={loading === "price"} onClick={openPriceWatch} className={ACTION_CLASS}>
            <IconBell size={16} />
            {t("watchPrice")}
          </Button>
          {/* ⛔ KNAPPEN FÖRSVINNER UNDER PAUSEN, den låses inte. Till skillnad
              från set-klockan (som är hela funktionen) är det här en av två
              knappar bredvid varandra — en grå "Bevaka restock" intill en aktiv
              "Bevaka pris" läser som ett fel i appen. Prisbevakningen står kvar
              och gör exakt det den lovar. */}
          {!restockPaused && (
            <Button
              variant="secondary"
              className={cn(ACTION_CLASS, "col-span-2")}
              loading={loading === "restock"}
              onClick={() =>
                void post(
                  "restock",
                  "/api/watchlist",
                  { productId, restockAlert: true },
                  t("restockWatchCreated")
                ).then((ok) => ok && setJustWatched(true))
              }
            >
              <IconPackage size={16} />
              {t("watchRestock")}
            </Button>
          )}
        </>
      )}
      <Button
        variant="secondary"
        className={ACTION_CLASS}
        loading={loading === "collection"}
        onClick={() => setCollectionModalOpen(true)}
      >
        <IconPlus size={16} />
        {t("addToCollection")}
      </Button>
      {isPro === false && (
        <ProTextLink source="product-alerts" className="col-span-2 text-xs font-medium text-holo-cyan hover:underline">
          {t(alertCopyKey("alertsProCta", priceAlertsPausedClient()))}
        </ProTextLink>
      )}
    </div>

    {/* Skylten, i det ögonblick bevakningen just skapades. Ligger UTANFÖR
        knappraden (som är `flex-wrap`) så den blir en egen rad i stället för ett
        till "chip" mellan knapparna. */}
    {justWatched && <DiscordRestockTip />}

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
            {t.rich(alertCopyKey("priceModalIntro", pricePaused), {
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

      <Modal
        open={collectionModalOpen}
        onClose={() => setCollectionModalOpen(false)}
        title={t("addToCollection")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCollectionModalOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => void saveCollection()} loading={loading === "collection"}>
              {t("addToCollection")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveCollection();
          }}
        >
          <Label htmlFor="collectionQuantity">{t("quantityLabel")}</Label>
          <Input
            id="collectionQuantity"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            autoFocus
          />
        </form>
      </Modal>
    </>
  );
}
