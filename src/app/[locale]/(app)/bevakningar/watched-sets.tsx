"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { restockAlertsPausedClient } from "@/lib/restock-alerts-pause";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { SafeImage } from "@/components/ui/safe-image";
import { IconCards, IconTrash } from "@/components/ui/icons";
import { setSetWatched } from "@/lib/watched-sets";

export interface WatchedSetRow {
  setId: string;
  name: string;
  series: string;
  /** Setets logotyp (eller symbol som reserv). Null → ikonen får stå kvar. */
  logoUrl: string | null;
  sealedCount: number;
}

/**
 * "Bevakade set" på bevakningssidan.
 *
 * Utan den här listan är en set-bevakning OSYNLIG: den skapas från ett produktkort
 * eller en setsida och syns sedan ingenstans, så det enda sättet att bli av med den
 * hade varit att hitta tillbaka till rätt set. Larm man inte kan stänga av är
 * värre än inga larm.
 *
 * Hela kortet döljs när listan är tom — en tom ruta med "du bevakar inga set" är
 * brus för alla som inte använder funktionen.
 */
export function WatchedSets({ initialSets }: { initialSets: WatchedSetRow[] }) {
  const t = useTranslations("Watch");
  const { toast } = useToast();
  const [sets, setSets] = useState(initialSets);
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(setId: string) {
    setBusy(setId);
    try {
      const res = await fetch(`/api/set-watch/${encodeURIComponent(setId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast({ title: t("failed"), variant: "error" });
        return;
      }
      setSets((s) => s.filter((x) => x.setId !== setId));
      // Klockorna i katalogen läser samma delade cache — utan detta hade de
      // fortsatt visa setet som bevakat tills nästa omladdning.
      setSetWatched(setId, false);
      toast({ title: t("setUnwatched"), variant: "success" });
    } catch {
      toast({ title: t("failed"), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  if (sets.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("watchedSetsTitle")}</CardTitle>
        <p className="text-sm text-ink-muted">
          {/* ⛔ Underrubriken lovar larm i presens. Under pausen måste den säga
              att seten ligger kvar men inte larmar — annars tolkar användaren
              tystnaden som att bevakningen slutat fungera och tar bort den. */}
          {restockAlertsPausedClient() ? t("watchedSetsSubPaused") : t("watchedSetsSub")}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-surface-border">
          {sets.map((s) => (
            <li key={s.setId} className="flex items-center justify-between gap-3 px-5 py-3">
              <Link
                href={`/sets/${s.setId}`}
                className="flex min-w-0 items-center gap-3 text-left transition-colors hover:text-holo-cyan"
              >
                {/* Setets logotyp — `object-contain` med FAST ruta: logotyperna
                    är olika breda (vissa nästan kvadratiska, vissa väldigt
                    liggande) och utan fast ruta hoppade texten i sidled mellan
                    raderna. SafeImage faller tillbaka på ikonen när bilden
                    saknas eller dör (samma skäl som i katalogen). */}
                <span className="grid h-9 w-12 shrink-0 place-items-center">
                  <SafeImage
                    src={s.logoUrl}
                    alt={s.name}
                    className="max-h-9 max-w-12 object-contain"
                    fallback={<IconCards size={18} className="text-ink-faint" />}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-ink-faint">
                    {s.series} · {t("sealedCount", { count: s.sealedCount })}
                  </span>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => void remove(s.setId)}
                disabled={busy === s.setId}
                aria-label={t("removeSetAria", { set: s.name })}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-surface-overlay/50 hover:text-fall focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan disabled:opacity-40"
              >
                <IconTrash size={16} />
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
