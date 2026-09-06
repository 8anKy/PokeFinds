"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getSharedSession } from "@/lib/client-session";
import { useRouter } from "@/i18n/navigation";
import { hasAuthHint } from "@/lib/auth-hint";
import { setProductWatched } from "@/lib/watched-products";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { IconBell, IconBellFilled, IconPlus } from "@/components/ui/icons";
import { DiscordRestockTip } from "@/components/features/discord-restock-tip";
import {
  ProductWatchSheet,
  type ProductWatchInput,
  type ProductWatchState,
} from "@/components/features/product-watch-sheet";

export interface ProductActionsProps {
  productId: string;
  title: string;
}

type ActionKey = "watch" | "collection";

/** Mobil: full bredd i sin rutnätscell, 48 px hög, text 15. Desktop: knappens vanliga md-mått. */
const ACTION_CLASS = "h-12 w-full px-3 text-[15px] sm:h-10 sm:w-auto sm:px-4 sm:text-sm";

/** Raden som /api/watchlist ger tillbaka — bara det arket behöver. */
interface WatchlistRow {
  id: string;
  priceAlert: boolean;
  restockAlert: boolean;
  targetPrice: number | null;
  product?: { id?: string };
}

function toState(row: WatchlistRow): ProductWatchState {
  return {
    id: row.id,
    priceAlert: row.priceAlert,
    restockAlert: row.restockAlert,
    targetPrice: row.targetPrice ?? null,
  };
}

/**
 * Produktsidans två knappar: BEVAKA och LÄGG TILL I SAMLING — lika breda, en rad
 * (hjälte-vyns regel, CLAUDE.md). Bevaka öppnar ett ark där prisfall + restock
 * väljs ihop och kan ändras/tas bort senare från samma knapp ("Bevakas").
 * Varför ett ark och inte två knappar: se product-watch-sheet.tsx.
 */
export function ProductActions({ productId, title }: ProductActionsProps) {
  const t = useTranslations("Detail");
  const tc = useTranslations("Common");
  const tw = useTranslations("Watch");
  const [loading, setLoading] = useState<ActionKey | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [quantity, setQuantity] = useState("1");
  /** Null = bevakas inte (eller okänt/utloggad). */
  const [watch, setWatch] = useState<ProductWatchState | null>(null);
  // Bevakning skapad HÄR OCH NU (inte "bevakas sedan tidigare") → Discord-tipset.
  // ⛔ Grinda den aldrig på `watch`: då hade skylten suttit kvar på varje besök
  // hos varje bevakad produkt, vilket är tjat och inte ett tips.
  const [justWatched, setJustWatched] = useState(false);
  // null = okänt (utloggad/laddar) → behandlas som Pro i arket; false = gratiskonto
  // (larm avfyras aldrig → raderna låses, produkten sparas utan larmflaggor).
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  // Läs plan klient-sida (produktsidan ISR-cachas → ingen server-auth). Bara om
  // fo_auth-cookien finns, så utloggade aldrig träffar /api/auth/session.
  useEffect(() => {
    if (!hasAuthHint()) return;
    void getSharedSession().then((s) => setIsPro(!!s?.user?.isPro));
  }, []);

  // Bevakas produkten redan, och med vilka val? Rå fetch (inte apiFetch) så en
  // utloggad besökare inte slängs till login av 401 på denna passiva koll.
  useEffect(() => {
    // Samma grind som plan-läsningen ovan: utan den blev det en garanterad
    // Neon-väckning per produktvisning för varje inloggad besökare (401:an är
    // gratis för utloggade, men den inloggade vägen träffar databasen).
    if (!hasAuthHint()) return;
    let cancelled = false;
    fetch("/api/watchlist", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: WatchlistRow[] } | null) => {
        if (cancelled || !d?.items) return;
        const row = d.items.find((it) => it.product?.id === productId);
        setWatch(row ? toState(row) : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [productId]);

  function openWatch() {
    if (!hasAuthHint()) {
      router.push("/logga-in");
      return;
    }
    setSheetOpen(true);
  }

  async function saveWatch(input: ProductWatchInput) {
    const existing = watch;
    setLoading("watch");
    try {
      const res = existing
        ? await fetch(`/api/watchlist/${encodeURIComponent(existing.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              priceAlert: input.priceAlert,
              restockAlert: input.restockAlert,
              targetPrice: input.targetPrice,
            }),
          })
        : await fetch("/api/watchlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productId,
              priceAlert: input.priceAlert,
              restockAlert: input.restockAlert,
              ...(input.targetPrice != null ? { targetPrice: input.targetPrice } : {}),
            }),
          });
      if (res.status === 401) {
        router.push("/logga-in");
        return;
      }
      // Servern svarar med svenska felmeddelanden → visa ALDRIG data.error rått
      // (läcker svenska i EN-läget). Varje status får sin egen lokaliserade text.
      if (res.status === 409) {
        // Raden fanns redan (skapad i en annan flik) — knappen visade fel läge.
        toast({ title: t("alreadyWatching"), description: t("alreadyWatchingDesc") });
        setSheetOpen(false);
        return;
      }
      if (res.status === 403 && !existing) {
        toast({ title: tw("limitReached"), description: tw("limitReachedDesc"), variant: "error" });
        return;
      }
      if (!res.ok) {
        toast({ title: t("actionFailed"), description: t("tryAgain"), variant: "error" });
        return;
      }
      const row = (await res.json()) as WatchlistRow;
      setWatch(toState(row));
      // Den delade cachen (klockorna i rutnäten) måste följa med.
      setProductWatched(productId, true);
      setSheetOpen(false);
      toast({ title: existing ? t("watchUpdated") : t("watchCreated"), variant: "success" });
      if (!existing) setJustWatched(true);
    } catch {
      toast({ title: t("tryAgain"), variant: "error" });
    } finally {
      setLoading(null);
    }
  }

  /** Sluta bevaka — nycklad på produkt, som klockan i produktkortet. */
  async function removeWatch() {
    setLoading("watch");
    try {
      const res = await fetch(`/api/watchlist?productId=${encodeURIComponent(productId)}`, {
        method: "DELETE",
      });
      if (res.status === 401) {
        router.push("/logga-in");
        return;
      }
      // 404 = raden fanns inte (borttagen i en annan flik) → knappen visade fel
      // läge, inte ett fel att larma om. Rätta läget i stället.
      if (!res.ok && res.status !== 404) {
        toast({ title: t("actionFailed"), description: t("tryAgain"), variant: "error" });
        return;
      }
      setWatch(null);
      setJustWatched(false);
      setProductWatched(productId, false);
      setSheetOpen(false);
      toast({ title: t("watchRemoved"), variant: "success" });
    } catch {
      toast({ title: t("tryAgain"), variant: "error" });
    } finally {
      setLoading(null);
    }
  }

  async function saveCollection() {
    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty < 1) {
      toast({ title: t("invalidPrice"), description: t("tryAgain"), variant: "error" });
      return;
    }
    setCollectionModalOpen(false);
    setLoading("collection");
    try {
      const res = await fetch("/api/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity: qty }),
      });
      if (res.status === 401) {
        router.push("/logga-in");
        return;
      }
      if (!res.ok) {
        toast({ title: t("actionFailed"), description: t("tryAgain"), variant: "error" });
        return;
      }
      toast({ title: t("addedToCollection"), variant: "success" });
    } catch {
      toast({ title: t("tryAgain"), variant: "error" });
    } finally {
      setLoading(null);
      setQuantity("1");
    }
  }

  return (
    <>
      {/* Mobil: två lika breda knappar i arket (48 px höga — tumvänliga).
          Desktop: raden som förut. */}
      <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
        <Button
          variant={watch ? "outline" : "primary"}
          loading={loading === "watch"}
          onClick={openWatch}
          className={cn(ACTION_CLASS, watch && "bg-holo-cyan/10")}
          aria-pressed={watch !== null}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
        >
          {/* Tillståndet bärs av glyfen (ifylld = bevakas) OCH ordet — samma
              språk som klockan i produktkortet. */}
          {watch ? <IconBellFilled size={16} /> : <IconBell size={16} />}
          {watch ? t("watching") : t("watchCta")}
        </Button>
        <Button
          variant="secondary"
          className={ACTION_CLASS}
          loading={loading === "collection"}
          onClick={() => setCollectionModalOpen(true)}
        >
          <IconPlus size={16} />
          {t("addToCollection")}
        </Button>
      </div>

      {/* Skylten, i det ögonblick bevakningen just skapades. Ligger UTANFÖR
          knappraden så den blir en egen rad i stället för ett till "chip". */}
      {justWatched && <DiscordRestockTip />}

      <ProductWatchSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        productTitle={title}
        current={watch}
        isPro={isPro !== false}
        saving={loading === "watch"}
        onSave={(input) => void saveWatch(input)}
        onRemove={() => void removeWatch()}
      />

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
