"use client";

/**
 * Adminåtgärder på EN användare: plan, Pro-gåva, roll. Låg förut som väljare
 * i listans rader (2026-09-16 flyttade ägaren dem hit — listan hade 14 kolumner
 * och rullade i sidled). Handlarna är oförändrade; se kommentarerna vid varje.
 */
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import type { PlanTier, Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const ROLE_LABELS: Record<Role, string> = {
  USER: "Användare",
  MODERATOR: "Moderator",
  ADMIN: "Admin",
  SUPERADMIN: "Superadmin",
};
const ALL_ROLES: Role[] = ["USER", "MODERATOR", "ADMIN", "SUPERADMIN"];
const PLAN_LABELS: Record<PlanTier, string> = { FREE: "Gratis", PREMIUM: "Premium" };
const ALL_PLANS: PlanTier[] = ["FREE", "PREMIUM"];

export function UserActions({
  userId,
  name,
  role,
  planTier,
  bonusProUntil,
  isPro,
  isSelf,
  isSuperAdmin,
}: {
  userId: string;
  name: string;
  role: Role;
  planTier: PlanTier;
  /** YYYY-MM-DD eller null. */
  bonusProUntil: string | null;
  isPro: boolean;
  isSelf: boolean;
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  async function patch(body: Record<string, unknown>, okTitle: string, okDesc?: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kunde inte uppdatera.");
      toast({ title: okTitle, description: okDesc, variant: "success" });
      router.refresh();
    } catch (error) {
      toast({
        title: "Fel vid uppdatering",
        description: error instanceof Error ? error.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="block">
        <span className="mb-1 block text-xs text-ink-muted">Plan (planTier)</span>
        <span className="flex items-center gap-2">
          <Select
            value={planTier}
            disabled={saving}
            onChange={(e) =>
              patch({ planTier: e.target.value }, "Plan uppdaterad", `${name} har nu ${PLAN_LABELS[e.target.value as PlanTier]}.`)
            }
            aria-label={`Ändra plan för ${name}`}
            className="h-9 w-32"
          >
            {ALL_PLANS.map((plan) => (
              <option key={plan} value={plan}>
                {PLAN_LABELS[plan]}
              </option>
            ))}
          </Select>
          {/* Pro kan komma från FYRA källor (planTier, bonus, Stripe, roll) —
              väljaren visar bara den första. Se isPro() i lib/plan.ts. */}
          {isPro && planTier !== "PREMIUM" && (
            <Badge variant="info" title="Pro via bonus, Stripe eller roll — inte via planTier">
              Pro
            </Badge>
          )}
        </span>
      </label>

      {/* ⛔ Gratis Pro = bonusProUntil, ALDRIG planTier=PREMIUM: den ägs av
          RevenueCat-webhooken (EXPIRATION nollar den) och blockerar Stripe-kassan. */}
      <label className="block">
        <span className="mb-1 block text-xs text-ink-muted">Gratis Pro t.o.m.</span>
        <span className="flex items-center gap-2">
          <Input
            type="date"
            value={bonusProUntil ?? ""}
            min={today}
            disabled={saving}
            onChange={(e) =>
              patch(
                { bonusProUntil: e.target.value || null },
                e.target.value ? "Pro tilldelad" : "Pro-gåvan borttagen",
                e.target.value ? `Gäller t.o.m. ${e.target.value}.` : undefined
              )
            }
            aria-label={`Ge ${name} gratis Pro till och med`}
            className="h-9 w-40"
          />
          {bonusProUntil && (
            <button
              type="button"
              onClick={() => patch({ bonusProUntil: null }, "Pro-gåvan borttagen")}
              disabled={saving}
              className="text-sm text-ink-faint transition-colors hover:text-fall disabled:opacity-50"
            >
              Rensa
            </button>
          )}
        </span>
      </label>

      {isSuperAdmin && (
        <label className="block">
          <span className="mb-1 block text-xs text-ink-muted">Roll</span>
          <Select
            value={role}
            disabled={saving || isSelf}
            onChange={(e) =>
              patch({ role: e.target.value }, "Roll uppdaterad", `${name} har nu rollen ${ROLE_LABELS[e.target.value as Role]}.`)
            }
            aria-label={`Ändra roll för ${name}`}
            title={isSelf ? "Du kan inte ändra din egen roll." : undefined}
            className="h-9 w-40"
          >
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </label>
      )}
    </div>
  );
}
