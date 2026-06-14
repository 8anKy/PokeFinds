"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { IconBell, IconPackage, IconPlus, IconShare } from "@/components/ui/icons";

export interface ProductActionsProps {
  productId: string;
  title: string;
}

type ActionKey = "price" | "restock" | "collection" | "share";

export function ProductActions({ productId, title }: ProductActionsProps) {
  const [loading, setLoading] = useState<ActionKey | null>(null);
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
    <div className="flex flex-wrap gap-2">
      <Button
        loading={loading === "price"}
        onClick={() =>
          post(
            "price",
            "/api/watchlist",
            { productId, priceAlert: true },
            "Prisbevakning skapad"
          )
        }
      >
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
  );
}
