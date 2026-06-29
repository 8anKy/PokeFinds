"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { IconBell, IconPackage, IconPlus, IconShare } from "@/components/ui/icons";

export interface ProductActionsProps {
  productId: string;
  title: string;
}

type ActionKey = "price" | "restock" | "collection" | "share";

export function ProductActions({ productId, title }: ProductActionsProps) {
  const [loading, setLoading] = useState<ActionKey | null>(null);
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [targetValue, setTargetValue] = useState("");
  const { toast } = useToast();
  const router = useRouter();

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
          title: "Det gick inte",
          description: data.error ?? "Något gick fel. Försök igen.",
          variant: "error",
        });
        return;
      }
      toast({ title: successTitle, variant: "success" });
    } catch {
      toast({ title: "Något gick fel. Försök igen.", variant: "error" });
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
        toast({ title: "Ogiltigt pris", description: "Ange ett pris i kronor.", variant: "error" });
        return;
      }
      targetPrice = Math.round(kr * 100);
    }
    setPriceModalOpen(false);
    await post(
      "price",
      "/api/watchlist",
      { productId, priceAlert: true, ...(targetPrice != null ? { targetPrice } : {}) },
      "Prisbevakning skapad"
    );
    setTargetValue("");
  }

  async function share() {
    setLoading("share");
    try {
      const url = window.location.href;
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: "Länken kopierad", variant: "success" });
      }
    } catch {
      // Användaren avbröt delningen — inget fel
    } finally {
      setLoading(null);
    }
  }

  return (
    <>
    <div className="flex flex-wrap gap-2">
      <Button loading={loading === "price"} onClick={() => setPriceModalOpen(true)}>
        <IconBell size={16} />
        Bevaka pris
      </Button>
      <Button
        variant="secondary"
        loading={loading === "restock"}
        onClick={() =>
          post(
            "restock",
            "/api/watchlist",
            { productId, restockAlert: true },
            "Restock-bevakning skapad"
          )
        }
      >
        <IconPackage size={16} />
        Bevaka restock
      </Button>
      <Button
        variant="secondary"
        loading={loading === "collection"}
        onClick={() =>
          post(
            "collection",
            "/api/collection",
            { productId, quantity: 1 },
            "Tillagd i din samling"
          )
        }
      >
        <IconPlus size={16} />
        Lägg till i samling
      </Button>
      <Button variant="ghost" loading={loading === "share"} onClick={share}>
        <IconShare size={16} />
        Dela
      </Button>
    </div>

      <Modal
        open={priceModalOpen}
        onClose={() => setPriceModalOpen(false)}
        title="Bevaka pris"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPriceModalOpen(false)}>
              Avbryt
            </Button>
            <Button onClick={() => void savePriceWatch()} loading={loading === "price"}>
              Bevaka
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
            Vi larmar dig när <span className="font-medium text-ink">{title}</span> kostar lika med
            eller mindre än ditt målpris. Lämna tomt för att bara bevaka prisfall.
          </p>
          <Label htmlFor="watchTargetPrice">Målpris (kr)</Label>
          <Input
            id="watchTargetPrice"
            inputMode="decimal"
            placeholder="t.ex. 499"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            autoFocus
          />
        </form>
      </Modal>
    </>
  );
}
