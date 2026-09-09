"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { signOut } from "next-auth/react";
import { dateLocaleTag } from "@/lib/format";
import { setAuthHint } from "@/lib/auth-hint";
import { alertCopyKey } from "@/lib/alert-copy";
import { apiFetch } from "@/lib/client-api";
import { priceAlertsPausedClient } from "@/lib/price-alerts-pause";
import { enablePush } from "@/lib/push-client";
import { downloadFromApi } from "@/lib/download";
import { openPaywallOrNavigate } from "@/lib/paywall";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label, FieldError } from "@/components/ui/input";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { RestockPausedBanner } from "@/components/features/restock-paused-banner";
import type { NotificationSettings } from "@/lib/notification-settings";
import type { SettingsUser } from "./settings-user";
import { ProLockControl, SettingsLinkRow, SettingsRow, SettingsSection, Toggle } from "./settings-ui";

/** Discord-loggan, inlinead (ingen extern asset att ladda eller cachebusta). */
function DiscordMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 127.14 96.36" fill="currentColor" aria-hidden className={className}>
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21H.55A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
    </svg>
  );
}

/**
 * Tradera-märket. ⛔ INTE Traderas logotyp: den är en ordbild utan fristående
 * symbol, och en påhittad "logotyp" vore ett felaktigt påstående om deras
 * varumärke. En prislapp bär betydelsen ("sälj dina kort") och färgen bär
 * igenkänningen — samma gula som Tradera-serien i prisgrafen.
 */
function TraderaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.8 12V4.8A2 2 0 0 1 4.8 2.8H12a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.8" cy="7.8" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Optimistiskt reglage mot /api/users/me: växla direkt, backa vid fel. */
function useOptimisticToggle(initial: boolean, onToast: { on: string; off: string }) {
  const { toast } = useToast();
  const t = useTranslations("Settings");
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function set(next: boolean, body: Record<string, unknown>) {
    setValue(next);
    setSaving(true);
    try {
      await apiFetch("/api/users/me", { method: "PATCH", body });
      toast({ title: next ? onToast.on : onToast.off, variant: "success" });
    } catch (e) {
      setValue(!next);
      toast({
        title: t("saveFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  return { value, saving, set };
}

// ---------------------------------------------------------------- Profil

export function ProfileSection({ user }: { user: SettingsUser }) {
  const { toast } = useToast();
  const t = useTranslations("Settings");
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (trimmed.length < 4 || trimmed.length > 12) {
      setError(t("nameMin"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/users/me", { method: "PATCH", body: { name: trimmed } });
      toast({ title: t("profileSaved"), variant: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("genericFail"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-[26px]">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div>
          <Label htmlFor="name">{t("nameLabel")}</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={12} />
        </div>
        <div>
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input id="email" value={user.email} disabled />
        </div>
        <FieldError message={error} />
        <Button type="submit" loading={saving}>
          {t("saveProfile")}
        </Button>
      </form>

      <SettingsSection title={t("languageTitle")}>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[15px] font-medium tracking-[-0.005em] text-ink">
            {t("languageTitle")}
          </span>
          <LocaleSwitcher />
        </div>
      </SettingsSection>
    </div>
  );
}

// ------------------------------------------------------------- Synlighet

export function VisibilitySection({ user }: { user: SettingsUser }) {
  const t = useTranslations("Settings");
  const collection = useOptimisticToggle(user.isPublicCollection, {
    on: t("publicCollectionOnToast"),
    off: t("publicCollectionOffToast"),
  });
  const asks = useOptimisticToggle(user.allowPurchaseRequests, {
    on: t("allowPurchaseRequestsOnToast"),
    off: t("allowPurchaseRequestsOffToast"),
  });

  return (
    <SettingsSection title={t("visibilityTitle")} footer={t("visibilityFooter")}>
      <SettingsRow
        label={t("publicCollection")}
        hint={t("publicCollectionHint")}
        control={
          <Toggle
            checked={collection.value}
            disabled={collection.saving}
            label={t("publicCollection")}
            onChange={(next) => void collection.set(next, { isPublicCollection: next })}
          />
        }
      />
      {/* "Är den till salu?"-knappen på rutorna. Bara meningsfull när samlingen är
          offentlig — visas ändå alltid, så valet inte försvinner när man slår av
          det ena. Community v2-grind som Tradera-reglaget. */}
      {user.communityV2 && (
        <SettingsRow
          label={t("allowPurchaseRequests")}
          hint={t("allowPurchaseRequestsHint")}
          control={
            <Toggle
              checked={asks.value}
              disabled={asks.saving}
              label={t("allowPurchaseRequests")}
              onChange={(next) =>
                void asks.set(next, { preferences: { allowPurchaseRequests: next } })
              }
            />
          }
        />
      )}
    </SettingsSection>
  );
}

// --------------------------------------------------------------- Notiser

export function NotificationsSection({ user }: { user: SettingsUser }) {
  const { toast } = useToast();
  const t = useTranslations("Settings");
  const router = useRouter();
  // Prislarmen har en EGEN paus (2026-08-26). Klientflaggan, inte serverns: den här
  // komponenten renderas i webbläsaren och ser bara NEXT_PUBLIC_-speglingen.
  const pricePaused = priceAlertsPausedClient();
  const [settings, setSettings] = useState<NotificationSettings>(user.notificationSettings);

  // Försoning: står push redan PÅ men enheten inte är registrerad (gammal data eller
  // en ny enhet) → registrera den faktiskt när inställningarna öppnas. No-op på webb
  // och om token redan finns; prompt:ar bara om behörighet ännu inte är avgjord.
  useEffect(() => {
    if (user.notificationSettings.push) void enablePush();
  }, [user.notificationSettings.push]);

  async function save(next: NotificationSettings) {
    const previous = settings;
    setSettings(next);
    try {
      await apiFetch("/api/users/me", { method: "PATCH", body: { notificationSettings: next } });
      toast({ title: t("notifSaved"), variant: "success" });
    } catch (e) {
      setSettings(previous);
      toast({
        title: t("saveFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    }
  }

  async function toggle(key: keyof NotificationSettings, checked: boolean) {
    // Slår man på push i den native appen → be om tillstånd + registrera enheten.
    if (key === "push" && checked) {
      const res = await enablePush();
      if (!res.ok) {
        toast({
          title: t("pushFailTitle"),
          description: res.reason ?? t("pushFailDesc"),
          variant: "error",
        });
        return;
      }
    }
    await save({ ...settings, [key]: checked });
  }

  function row(key: keyof NotificationSettings, label: string, hint?: string, indent?: boolean) {
    return (
      <SettingsRow
        key={key}
        label={label}
        hint={hint}
        indent={indent}
        control={
          <Toggle
            checked={settings[key]}
            label={label}
            onChange={(next) => void toggle(key, next)}
          />
        }
      />
    );
  }

  return (
    <div className="space-y-[26px]">
      <RestockPausedBanner />

      {/* ⛔ E-POST ÄR EN HUVUDBRYTARE och de tre som beror på den ligger INDRAGNA.
          Beroendet bars förr av tre hinttexter som alla slutade med "Kräver att
          e-postnotiser är på" — formen säger samma sak utan att upprepa sig.
          ⛔ Mastern styr fler utskick än larmen (veckobrev, kontomejl), så hinten
          måste sluta säga "prislarm" medan de är pausade. */}
      <SettingsSection title={t("notifTitle")}>
        {row("email", t("notifEmail"), t(alertCopyKey("notifEmailHint", pricePaused)))}
        {row("weekly", t("notifWeekly"), undefined, true)}
        {row("news", t("notifNews"), undefined, true)}
        {user.isPro ? (
          row(
            "allRestocks",
            t("notifAll"),
            user.restockPaused ? t("notifAllPausedHint") : t("notifAllHint"),
            true
          )
        ) : (
          <SettingsRow
            label={t("notifAll")}
            hint={user.restockPaused ? t("notifAllPausedHint") : t("notifAllHint")}
            indent
            control={
              <ProLockControl
                label={t("proTag")}
                onClick={() => openPaywallOrNavigate(router, { source: "settings-restocks" })}
              />
            }
          />
        )}
        {row("push", t("notifPush"), t("notifPushHint"))}
      </SettingsSection>
    </div>
  );
}

// ------------------------------------------------------------ Kopplingar

export function ConnectionsSection({ user }: { user: SettingsUser }) {
  const { toast } = useToast();
  const t = useTranslations("Settings");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [discordUsername, setDiscordUsername] = useState(user.discordUsername);
  const [disconnectingDiscord, setDisconnectingDiscord] = useState(false);
  const [traderaUserId, setTraderaUserId] = useState(user.traderaUserId);
  const [disconnectingTradera, setDisconnectingTradera] = useState(false);
  const showListings = useOptimisticToggle(user.showTraderaListings, {
    on: t("traderaShowOnToast"),
    off: t("traderaShowOffToast"),
  });

  // Kvittens efter återkomsten från Discord/Tradera. Statuskoden ligger i URL:en
  // eftersom callbacken är en REDIRECT och inte kan returnera något till klienten
  // på annat sätt. ⛔ Callbackarna pekar på /installningar/kopplingar sedan
  // 2026-09-09 — landar de på registret igen tappar användaren sin plats.
  useEffect(() => {
    const discord = searchParams.get("discord");
    if (discord === "ansluten") {
      toast({ title: t("discordConnectedToast"), variant: "success" });
    } else if (discord === "nekad") {
      toast({ title: t("discordCancelledToast"), variant: "error" });
    } else if (discord === "fel-redan-lankad") {
      toast({ title: t("discordAlreadyLinkedToast"), variant: "error" });
    } else if (discord?.startsWith("fel")) {
      toast({ title: t("discordErrorToast"), description: discord, variant: "error" });
    }

    const tradera = searchParams.get("tradera");
    if (tradera === "ansluten") {
      toast({ title: t("traderaConnectedToast"), variant: "success" });
    } else if (tradera === "nekad") {
      toast({ title: t("traderaCancelledToast"), variant: "error" });
    } else if (tradera?.startsWith("fel")) {
      const detail = searchParams.get("tradera_detail");
      toast({
        title: t("traderaErrorToast"),
        description: detail ? `${tradera}: ${detail}` : tradera,
        variant: "error",
      });
    }
    if (discord || tradera) router.replace("/installningar/kopplingar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function disconnect(kind: "discord" | "tradera") {
    const setBusy = kind === "discord" ? setDisconnectingDiscord : setDisconnectingTradera;
    setBusy(true);
    try {
      await apiFetch(kind === "discord" ? "/api/discord" : "/api/tradera", { method: "DELETE" });
      if (kind === "discord") setDiscordUsername(null);
      else {
        setTraderaUserId(null);
        // Servern nollar samtycket i samma skrivning; spegla det så reglaget inte
        // står kvar påslaget om användaren kopplar igen i samma vy.
        void showListings.set(false, {});
      }
      toast({
        title: kind === "discord" ? t("discordDisconnectedToast") : t("traderaDisconnectedToast"),
        variant: "success",
      });
    } catch (e) {
      toast({
        title: t("disconnectFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-[26px]">
      {user.discordEnabled && (
        <SettingsSection
          title={t("discordTitle")}
          footer={
            discordUsername
              ? t("discordConnectedDesc", { name: discordUsername })
              : t("discordDisconnectedDesc")
          }
        >
          {/* ⛔ Namnet och KNAPPEN står på var sin rad. Sida vid sida bröt en lång
              knappetikett ("Connect Tradera account") tjänstenamnet i två rader,
              och båda språken måste rymmas utan att raden ändrar form. */}
          <div className="flex items-center gap-3.5 border-b border-surface-border px-4 py-3">
            <DiscordMark className="h-5 w-5 shrink-0 text-discord" />
            <span className="flex-1 text-[15px] font-medium tracking-[-0.005em] text-ink">
              {t("discordTitle")}
            </span>
            <span className="shrink-0 text-sm text-ink-faint">
              {discordUsername ?? t("notConnected")}
            </span>
          </div>
          <div className="px-4 py-3">
            {discordUsername ? (
              <Button
                variant="secondary"
                className="w-full justify-center"
                loading={disconnectingDiscord}
                onClick={() => void disconnect("discord")}
              >
                {t("disconnectDiscord")}
              </Button>
            ) : (
              // Vanlig <a>, INTE next/link: en OAuth-omdirigering till discord.com
              // måste vara en riktig sidnavigering, klientroutingen klarar den inte.
              <a
                href="/api/discord/connect"
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-discord px-4 text-sm font-semibold text-white transition-all duration-200 ease-out hover:bg-discord-hover active:scale-[0.97]"
              >
                <DiscordMark className="h-4 w-4" />
                {t("connectDiscord")}
              </a>
            )}
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        title={t("traderaTitle")}
        footer={
          traderaUserId
            ? t("traderaConnectedDesc", { id: traderaUserId })
            : t("traderaDisconnectedDesc")
        }
      >
        <div className="flex items-center gap-3.5 border-b border-surface-border px-4 py-3">
          <TraderaMark className="h-5 w-5 shrink-0 text-tradera" />
          <span className="flex-1 text-[15px] font-medium tracking-[-0.005em] text-ink">
            {t("traderaTitle")}
          </span>
          <span className="shrink-0 text-sm text-ink-faint">
            {traderaUserId ? t("connected") : t("notConnected")}
          </span>
        </div>
        <div className="border-b border-surface-border px-4 py-3 last:border-b-0">
          {traderaUserId ? (
            <Button
              variant="secondary"
              className="w-full justify-center"
              loading={disconnectingTradera}
              onClick={() => void disconnect("tradera")}
            >
              {t("disconnectTradera")}
            </Button>
          ) : (
            // Vanlig <a> av samma skäl som Discord. Traderas gula (inte appens
            // turkos): raden identifierar en ANNAN tjänst. Svart text — gult är en
            // ljus yta där vit text faller under kontrastkravet.
            <a
              href="/api/tradera/connect"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-tradera px-4 text-sm font-semibold text-surface transition-all duration-200 ease-out hover:bg-tradera-hover active:scale-[0.97]"
            >
              <TraderaMark className="h-4 w-4" />
              {t("connectTradera")}
            </a>
          )}
        </div>
        {/* Visa annonserna på profilen — bara när kopplad OCH community v2 syns
            för den här besökaren. Reglaget är ett SAMTYCKE, därför default av. */}
        {traderaUserId && user.communityV2 && (
          <SettingsRow
            label={t("traderaShowOnProfile")}
            hint={t("traderaShowOnProfileHint")}
            control={
              <Toggle
                checked={showListings.value}
                disabled={showListings.saving}
                label={t("traderaShowOnProfile")}
                onChange={(next) => void showListings.set(next, { showTraderaListings: next })}
              />
            }
          />
        )}
      </SettingsSection>
    </div>
  );
}

// ------------------------------------------------------------------ Plan

export function PlanRow({ user }: { user: SettingsUser }) {
  const t = useTranslations("Settings");
  const locale = useLocale();
  const router = useRouter();
  const pricePaused = priceAlertsPausedClient();

  return (
    <SettingsSection
      title={t("planTitle")}
      footer={t(alertCopyKey(user.isPro ? "planProDesc" : "planFreeDesc", pricePaused))}
    >
      {/* Gratisperioden visas med SLUTDATUM. Utan datumet upptäcker användaren att
          perioden tagit slut genom att larmen tystnar — vilket läser som ett fel i
          appen, inte som ett utgånget erbjudande. */}
      {user.isPro && !user.bonusProUntil ? (
        <SettingsRow label={t("proBadge")} value={t("planTitle")} />
      ) : (
        <button
          type="button"
          onClick={() => openPaywallOrNavigate(router, { source: "settings" })}
          className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-surface-overlay/60 active:bg-surface-overlay"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold tracking-[-0.005em] text-holo-cyan">
              {user.bonusProUntil ? t("continueProCta") : t("upgradeCta")}
            </span>
            <span className="mt-0.5 block text-[12.5px] leading-[17px] text-ink-faint">
              {user.bonusProUntil
                ? t("freeUntil", {
                    date: new Date(user.bonusProUntil).toLocaleDateString(dateLocaleTag(locale), {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    }),
                  })
                : t("freeBadge")}
            </span>
          </span>
          <span className="shrink-0 text-[13px] text-ink-faint">{t("planPrice")}</span>
        </button>
      )}
    </SettingsSection>
  );
}

// ----------------------------------------------------------------- Konto

export function AccountSection() {
  const { toast } = useToast();
  const t = useTranslations("Settings");
  const tc = useTranslations("Common");
  const deleteWord = t("deleteWord");
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function deleteAccount() {
    if (confirmText !== deleteWord) return;
    setDeleting(true);
    try {
      await apiFetch("/api/users/me", { method: "DELETE" });
      toast({ title: t("deleteSuccess"), variant: "success" });
      setAuthHint(false);
      await signOut({ callbackUrl: "/" });
    } catch (e) {
      toast({
        title: t("deleteFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
      setDeleting(false);
    }
  }

  return (
    <>
      <SettingsSection title={t("gdprTitle")} footer={t("gdprDesc")}>
        <SettingsLinkRow
          label={t("exportData")}
          onClick={() =>
            void downloadFromApi("/api/users/me/export", "foilio-data.json").catch(() =>
              toast({ title: t("genericFail"), variant: "error" })
            )
          }
        />
        <SettingsLinkRow label={t("deleteAccount")} danger onClick={() => setOpen(true)} />
      </SettingsSection>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setConfirmText("");
        }}
        title={t("deleteModalTitle")}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setConfirmText("");
              }}
            >
              {tc("cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={confirmText !== deleteWord}
              loading={deleting}
              onClick={() => void deleteAccount()}
            >
              {t("deleteConfirmBtn")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            {t.rich("deleteWarning", {
              b: (chunks) => <span className="font-semibold text-fall">{chunks}</span>,
            })}
          </p>
          <div>
            <Label htmlFor="confirmDelete">
              {t.rich("deleteConfirmPrompt", {
                word: deleteWord,
                code: (chunks) => <span className="font-mono font-bold">{chunks}</span>,
              })}
            </Label>
            <Input
              id="confirmDelete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
