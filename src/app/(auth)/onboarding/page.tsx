"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Checkbox, FieldError, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const INTERESTS = [
  "Sealed",
  "Singles",
  "Slabs/Gradat",
  "Japanskt",
  "Engelskt",
  "Investering",
  "Casual collecting",
] as const;

type Budget = "low" | "medium" | "high";

const BUDGETS: { value: Budget; label: string; description: string }[] = [
  { value: "low", label: "Låg", description: "Under 500 kr/mån" },
  { value: "medium", label: "Mellan", description: "500–2000 kr/mån" },
  { value: "high", label: "Hög", description: "2000+ kr/mån" },
];

interface SetItem {
  id: string;
  name: string;
  series: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { update } = useSession();

  const [step, setStep] = useState(1);
  const [interests, setInterests] = useState<string[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [sets, setSets] = useState<SetItem[]>([]);
  const [setsLoading, setSetsLoading] = useState(true);
  const [favoriteSets, setFavoriteSets] = useState<string[]>([]);
  const [notif, setNotif] = useState({ email: true, inApp: true, weeklyReport: true });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sets?pageSize=24");
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

  function toggle(list: string[], value: string, setter: (next: string[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function nextFromStep1() {
    if (interests.length === 0) {
      setError("Välj minst ett intresse.");
      return;
    }
    if (!budget) {
      setError("Välj din ungefärliga budget.");
      return;
    }
    setError(null);
    setStep(2);
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
          budget,
          interests,
          notificationSettings: notif,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Något gick fel. Försök igen.");
        setSubmitting(false);
        return;
      }
      await update();
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Något gick fel. Försök igen.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-medium text-holo-cyan">Steg {step} av 3</p>
        <div className="mt-2 flex gap-1.5">
          {[1, 2, 3].map((s) => (
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
          <h1 className="font-display text-2xl font-bold text-ink">Vad samlar du på?</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Hjälp oss skräddarsy Foilio efter dina intressen.
          </p>

          <div className="mt-5">
            <Label>Intressen</Label>
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((interest) => {
                const active = interests.includes(interest);
                return (
                  <button
                    key={interest}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggle(interests, interest, setInterests)}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                      active
                        ? "border-holo-cyan bg-holo-cyan/15 font-medium text-holo-cyan"
                        : "border-surface-border bg-surface-raised text-ink-muted hover:border-holo-cyan/50 hover:text-ink"
                    )}
                  >
                    {interest}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5">
            <Label>Budget per månad</Label>
            <div className="grid grid-cols-3 gap-2">
              {BUDGETS.map((b) => {
                const active = budget === b.value;
                return (
                  <button
                    key={b.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setBudget(b.value)}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      active
                        ? "border-holo-cyan bg-holo-cyan/10"
                        : "border-surface-border bg-surface-raised hover:border-holo-cyan/50"
                    )}
                  >
                    <span
                      className={cn(
                        "block text-sm font-semibold",
                        active ? "text-holo-cyan" : "text-ink"
                      )}
                    >
                      {b.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-muted">{b.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <FieldError message={error} className="mt-4" />

          <Button onClick={nextFromStep1} className="mt-6 w-full" size="lg">
            Fortsätt
          </Button>
        </div>
      )}

      {step === 2 && (
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Dina favoritset</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Välj de set du följer extra noga. Du kan ändra detta senare.
          </p>

          <div className="mt-5 max-h-72 overflow-y-auto pr-1">
            {setsLoading ? (
              <p className="py-8 text-center text-sm text-ink-muted">Hämtar set…</p>
            ) : sets.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-muted">
                Inga set hittades just nu. Du kan hoppa över detta steg.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {sets.map((set) => {
                  const active = favoriteSets.includes(set.id);
                  return (
                    <button
                      key={set.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggle(favoriteSets, set.id, setFavoriteSets)}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-colors",
                        active
                          ? "border-holo-cyan bg-holo-cyan/10"
                          : "border-surface-border bg-surface-raised hover:border-holo-cyan/50"
                      )}
                    >
                      <span
                        className={cn(
                          "block truncate text-sm font-medium",
                          active ? "text-holo-cyan" : "text-ink"
                        )}
                      >
                        {set.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink-muted">
                        {set.series}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-6 flex gap-3">
            <Button variant="secondary" onClick={() => setStep(1)} className="flex-1" size="lg">
              Tillbaka
            </Button>
            <Button onClick={() => setStep(3)} className="flex-1" size="lg">
              Fortsätt
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Aviseringar</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Hur vill du bli notifierad vid prisfall och restocks?
          </p>

          <div className="mt-5 space-y-3">
            <div className="rounded-lg border border-surface-border bg-surface-raised p-3">
              <Checkbox
                id="notif-email"
                label="E-postaviseringar vid prisfall och restocks"
                checked={notif.email}
                onChange={(e) => setNotif((n) => ({ ...n, email: e.target.checked }))}
              />
            </div>
            <div className="rounded-lg border border-surface-border bg-surface-raised p-3">
              <Checkbox
                id="notif-inapp"
                label="Aviseringar i appen"
                checked={notif.inApp}
                onChange={(e) => setNotif((n) => ({ ...n, inApp: e.target.checked }))}
              />
            </div>
            <div className="rounded-lg border border-surface-border bg-surface-raised p-3">
              <Checkbox
                id="notif-weekly"
                label="Veckorapport med marknadsöversikt"
                checked={notif.weeklyReport}
                onChange={(e) => setNotif((n) => ({ ...n, weeklyReport: e.target.checked }))}
              />
            </div>
          </div>

          <FieldError message={error} className="mt-4" />

          <div className="mt-6 flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setStep(2)}
              className="flex-1"
              size="lg"
              disabled={submitting}
            >
              Tillbaka
            </Button>
            <Button onClick={handleSubmit} loading={submitting} className="flex-1" size="lg">
              Slutför
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
