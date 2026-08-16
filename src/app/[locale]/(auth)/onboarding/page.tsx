"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Checkbox, FieldError } from "@/components/ui/input";
import { SafeImage } from "@/components/ui/safe-image";
import { IconCards, IconCheck } from "@/components/ui/icons";
import { IconDiscord } from "@/components/ui/brand-icons";
import { DISCORD_URL } from "@/lib/social-links";
import { cn } from "@/lib/utils";

/*
 * ONBOARDINGEN ÄR TVÅ STEG (2026-08-16). Den var tre: ett obligatoriskt
 * "intressen + budget"-steg låg först och blockerade "Fortsätt" tills båda var
 * ifyllda. Svaren skrevs till `User.preferences` och lästes sedan av INGEN kod
 * i hela repot — två grindar mellan registrering och första värdeupplevelse för
 * data som var död vid ankomst. Stegen är borta; favoritseten är kvar därför att
 * de FAKTISKT läses (`favoriteSetIds()` → rankningssignal i services/products.ts).
 *
 * ⛔ Favoritseten skapar INGA set-bevakningar. `addSetWatch` är en hård Pro-grind,
 * och att tyst lägga rader i bevakningslistan ur ett registreringskryss är ett
 * annat påstående än att användaren bad om bevakningen.
 */

interface SetItem {
  id: string;
  name: string;
  series: string;
  /** Setets logotyp. Null → neutral kort-ikon (samma reserv som setfiltret). */
  logoUrl: string | null;
}

// Hur många set som visas att välja bland. Listan är sorterad nyast först, och
// det är de nya seten folk har en åsikt om vid registrering — 30 fyller rutnätet
// utan att göra steget till en katalog man måste bläddra igenom.
const SET_CHOICES = 30;

const TOTAL_STEPS = 2;

export default function OnboardingPage() {
  const t = useTranslations("Auth.onboarding");
  const tError = useTranslations("Auth");
  const router = useRouter();
  const { update } = useSession();

  const [step, setStep] = useState(1);
  const [sets, setSets] = useState<SetItem[]>([]);
  const [setsLoading, setSetsLoading] = useState(true);
  const [favoriteSets, setFavoriteSets] = useState<string[]>([]);
  const [notif, setNotif] = useState({ email: true });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sets?pageSize=${SET_CHOICES}`);
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { items?: SetItem[] };
        if (!cancelled) setSets(data.items ?? []);
      } catch {
        if (!cancelled) setSets([]);
      } finally {
        if (!cancelled) setSetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleFavorite(value: string) {
    setFavoriteSets((list) =>
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
    );
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/users/me/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          favoriteSets,
          notificationSettings: notif,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? tError("genericError"));
        setSubmitting(false);
        return;
      }
      await update();
      router.push("/produkter");
      router.refresh();
    } catch {
      setError(tError("genericError"));
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-medium text-holo-cyan">{t("step", { step })}</p>
        <div className="mt-2 flex gap-1.5">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
            <span
              key={s}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                s <= step ? "bg-holo-cyan" : "bg-surface-border"
              )}
            />
          ))}
        </div>
      </div>

      {step === 1 && (
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t("favoritesTitle")}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {t("favoritesSubtitle")}
          </p>

          <div className="mt-5 max-h-[22rem] overflow-y-auto pr-1">
            {setsLoading ? (
              <p className="py-8 text-center text-sm text-ink-muted">{t("loadingSets")}</p>
            ) : sets.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-muted">
                {t("noSets")}
              </p>
            ) : (
              // Samma logotypbricka som setfiltret på /produkter och "Bevakade
              // set" — ett set känns igen på sin logotyp, inte på sitt namn, och
              // två olika utseenden för samma val hade läst som två funktioner.
              <div className="grid grid-cols-3 gap-2.5">
                {sets.map((set) => {
                  const active = favoriteSets.includes(set.id);
                  return (
                    <button
                      key={set.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleFavorite(set.id)}
                      className="flex flex-col gap-1.5 text-center"
                    >
                      <span
                        className={cn(
                          "relative flex h-16 items-center justify-center rounded-[10px] border bg-surface px-2 transition-all",
                          active ? "border-holo-cyan shadow-glow" : "border-surface-border"
                        )}
                      >
                        <SafeImage
                          src={set.logoUrl}
                          alt=""
                          className="max-h-full max-w-full object-contain"
                          fallback={
                            <IconCards
                              size={22}
                              className={active ? "text-holo-cyan" : "text-ink-faint"}
                            />
                          }
                        />
                        {active && (
                          <span className="absolute right-1 top-1 grid h-[15px] w-[15px] place-items-center rounded-full bg-holo-cyan text-surface">
                            <IconCheck size={10} strokeWidth={3.4} />
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "line-clamp-2 text-[11px] font-medium leading-snug",
                          active ? "text-holo-cyan" : "text-ink"
                        )}
                      >
                        {set.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Inget "Tillbaka" — det här ÄR första steget. Och inget val krävs:
              tom lista är ett giltigt svar (rankningen faller tillbaka på
              bevakningar och samling). */}
          <Button onClick={() => setStep(2)} className="mt-6 w-full" size="lg">
            {t("continue")}
          </Button>
        </div>
      )}

      {step === 2 && (
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t("notifTitle")}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {t("notifSubtitle")}
          </p>

          <div className="mt-5 space-y-3">
            <div className="rounded-lg border border-surface-border bg-surface-raised p-3">
              <Checkbox
                id="notif-email"
                label={t("notifEmail")}
                checked={notif.email}
                onChange={(e) => setNotif((n) => ({ ...n, email: e.target.checked }))}
              />
            </div>

            {/* Discord-inbjudan i SISTA steget, inte som ett eget extra steg:
                registreringen ska inte bli längre för att vi vill ha medlemmar.
                ⛔ `target="_blank"` är inte kosmetik — öppnades servern i samma
                flik vore onboardingen övergiven precis före "Slutför", och
                svaren (favoritset, aviseringsval) hade aldrig sparats. */}
            <div className="rounded-lg border border-surface-border bg-surface-raised p-4">
              <div className="flex items-start gap-3">
                <IconDiscord size={22} className="mt-0.5 shrink-0 text-ink-muted" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{t("discordTitle")}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                    {t("discordBody")}
                  </p>
                  <a
                    href={DISCORD_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center rounded-lg border border-holo-cyan/50 px-3 py-1.5 text-xs font-semibold text-holo-cyan transition-colors hover:bg-holo-cyan/10"
                  >
                    {t("discordCta")}
                  </a>
                </div>
              </div>
            </div>
          </div>

          <FieldError message={error} className="mt-4" />

          <div className="mt-6 flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setStep(1)}
              className="flex-1"
              size="lg"
              disabled={submitting}
            >
              {t("back")}
            </Button>
            <Button onClick={handleSubmit} loading={submitting} className="flex-1" size="lg">
              {t("finish")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
