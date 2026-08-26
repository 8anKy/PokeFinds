"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { signOut } from "next-auth/react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { setAuthHint } from "@/lib/auth-hint";
import { alertCopyKey } from "@/lib/alert-copy";
import { apiFetch } from "@/lib/client-api";
import { priceAlertsPausedClient } from "@/lib/price-alerts-pause";
import { enablePush } from "@/lib/push-client";
import { useToast } from "@/components/ui/toast";
import { Button, LinkButton } from "@/components/ui/button";
import { downloadFromApi } from "@/lib/download";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input, Label, Checkbox, FieldError } from "@/components/ui/input";
import type { NotificationSettings } from "@/lib/notification-settings";
import { RestockPausedBanner } from "@/components/features/restock-paused-banner";

// ⛔ Formen bor i src/lib/notification-settings.ts tillsammans med läsaren och
// defaultvärdena — en lokal kopia hade kunnat glida isär från det som faktiskt
// sparas i kolumnen.
export type { NotificationSettings };

export interface SettingsUser {
  name: string;
  email: string;
  bio: string | null;
  planTier: "FREE" | "PREMIUM";
  /** Pro-förmåner (planTier ELLER admin-roll) — grinda features på denna, ej planTier. */
  isPro: boolean;
  /** ISO-datum när en GRATIS Pro-period tar slut, annars null. Se page.tsx. */
  bonusProUntil: string | null;
  notificationSettings: NotificationSettings;
  traderaUserId: string | null;
  /** Discord-visningsnamnet när kontot är länkat, annars null. */
  discordUsername: string | null;
  /** Är integrationen påslagen i miljön? Falskt → kortet visas inte alls. */
  discordEnabled: boolean;
  /** Restock-larmen avstängda? Då får "Alla restocks" inte gå att slå på. */
  restockPaused: boolean;
}

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

export function SettingsClient({ user }: { user: SettingsUser }) {
  const { toast } = useToast();
  const tSettings = useTranslations("Settings");
  const tc = useTranslations("Common");
  const tPause = useTranslations("RestockPause");
  // Prislarmen har en EGEN paus (2026-08-26). Klientflaggan, inte serverns: den här
  // komponenten renderas i webbläsaren och ser bara NEXT_PUBLIC_-speglingen.
  const pricePaused = priceAlertsPausedClient();
  const deleteWord = tSettings("deleteWord");
  const router = useRouter();
  const searchParams = useSearchParams();

  // Tradera-koppling
  const [traderaUserId, setTraderaUserId] = useState(user.traderaUserId);
  const [disconnectingTradera, setDisconnectingTradera] = useState(false);

  // Discord-koppling
  const [discordUsername, setDiscordUsername] = useState(user.discordUsername);
  const [disconnectingDiscord, setDisconnectingDiscord] = useState(false);

  // Kvittens efter återkomsten från Discord. Samma form som Tradera-blocket
  // nedan: statuskoden ligger i URL:en eftersom callbacken är en REDIRECT och
  // inte kan returnera något till klienten på annat sätt.
  useEffect(() => {
    const status = searchParams.get("discord");
    if (!status) return;
    if (status === "ansluten") {
      toast({ title: tSettings("discordConnectedToast"), variant: "success" });
    } else if (status === "nekad") {
      toast({ title: tSettings("discordCancelledToast"), variant: "error" });
    } else if (status === "fel-redan-lankad") {
      toast({ title: tSettings("discordAlreadyLinkedToast"), variant: "error" });
    } else if (status.startsWith("fel")) {
      toast({ title: tSettings("discordErrorToast"), description: status, variant: "error" });
    }
    router.replace("/installningar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function disconnectDiscord() {
    setDisconnectingDiscord(true);
    try {
      await apiFetch("/api/discord", { method: "DELETE" });
      setDiscordUsername(null);
      toast({ title: tSettings("discordDisconnectedToast"), variant: "success" });
    } catch (e) {
      toast({
        title: tSettings("disconnectFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setDisconnectingDiscord(false);
    }
  }

  useEffect(() => {
    const status = searchParams.get("tradera");
    if (!status) return;
    if (status === "ansluten") {
      toast({ title: tSettings("traderaConnectedToast"), variant: "success" });
    } else if (status === "nekad") {
      toast({ title: tSettings("traderaCancelledToast"), variant: "error" });
    } else if (status.startsWith("fel")) {
      // ponytail: temporär felkods-suffix för felsökning — ta bort description när flödet är verifierat.
      const detail = searchParams.get("tradera_detail");
      toast({
        title: tSettings("traderaErrorToast"),
        description: detail ? `${status}: ${detail}` : status,
        variant: "error",
      });
    }
    router.replace("/installningar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function disconnectTradera() {
    setDisconnectingTradera(true);
    try {
      await apiFetch("/api/tradera", { method: "DELETE" });
      setTraderaUserId(null);
      toast({ title: tSettings("traderaDisconnectedToast"), variant: "success" });
    } catch (e) {
      toast({
        title: tSettings("disconnectFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setDisconnectingTradera(false);
    }
  }

  // Profil
  const [name, setName] = useState(user.name);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Notiser
  const [settings, setSettings] = useState<NotificationSettings>(user.notificationSettings);
  const [savingSettings, setSavingSettings] = useState(false);

  // Radera konto
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Försoning: står push redan PÅ men enheten inte är registrerad (gammal data eller
  // ett nytt enhet) → registrera den faktiskt när inställningarna öppnas. No-op på web
  // och om token redan finns; prompt:ar bara om behörighet ännu inte är avgjord.
  useEffect(() => {
    if (user.notificationSettings.push) void enablePush();
  }, [user.notificationSettings.push]);

  async function saveProfile() {
    const trimmed = name.trim();
    if (trimmed.length < 4 || trimmed.length > 12) {
      setProfileError(tSettings("nameMin"));
      return;
    }
    setSavingProfile(true);
    setProfileError(null);
    try {
      await apiFetch("/api/users/me", {
        method: "PATCH",
        body: { name: trimmed },
      });
      toast({ title: tSettings("profileSaved"), variant: "success" });
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : tSettings("genericFail"));
    } finally {
      setSavingProfile(false);
    }
  }

  async function toggleSetting(key: keyof NotificationSettings, checked: boolean) {
    // Slår man på push i den native appen → be om tillstånd + registrera enheten.
    if (key === "push" && checked) {
      const res = await enablePush();
      if (!res.ok) {
        toast({
          title: tSettings("pushFailTitle"),
          description: res.reason ?? tSettings("pushFailDesc"),
          variant: "error",
        });
        return;
      }
    }
    await saveNotificationSettings({ ...settings, [key]: checked });
  }

  async function saveNotificationSettings(next: NotificationSettings) {
    const previous = settings;
    setSettings(next);
    setSavingSettings(true);
    try {
      await apiFetch("/api/users/me", {
        method: "PATCH",
        body: { notificationSettings: next },
      });
      toast({ title: tSettings("notifSaved"), variant: "success" });
    } catch (e) {
      setSettings(previous);
      toast({
        title: tSettings("saveFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function deleteAccount() {
    if (confirmText !== deleteWord) return;
    setDeleting(true);
    try {
      await apiFetch("/api/users/me", { method: "DELETE" });
      toast({ title: tSettings("deleteSuccess"), variant: "success" });
      setAuthHint(false);
      await signOut({ callbackUrl: "/" });
    } catch (e) {
      toast({
        title: tSettings("deleteFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
      setDeleting(false);
    }
  }

  const notificationOptions: { key: keyof NotificationSettings; label: string; hint: string }[] = [
    // ⛔ E-post-mastern styr fler utskick än larmen (veckobrev, kontomejl). Hinten
    // måste därför sluta säga "prislarm" medan de är pausade — annars läser en
    // påslagen kryssruta som ett löfte om larm som aldrig kommer.
    { key: "email", label: tSettings("notifEmail"), hint: tSettings(alertCopyKey("notifEmailHint", pricePaused)) },
    // Veckobrevet är en EGEN spak och gäller alla konton, inte bara Pro. Ligger
    // direkt under e-post-mastern eftersom det är den som styr över den.
    { key: "weekly", label: tSettings("notifWeekly"), hint: tSettings("notifWeeklyHint") },
    {
      key: "allRestocks",
      label: tSettings("notifAll"),
      // ⛔ Hela reglaget styr EN pausad funktion. Hade hinten stått kvar hade
      //    den beskrivit larm som aldrig skickas.
      hint: user.restockPaused ? tSettings("notifAllPausedHint") : tSettings("notifAllHint"),
    },
    { key: "push", label: tSettings("notifPush"), hint: tSettings("notifPushHint") },
  ];

  return (
    <div className="space-y-6">
      {/* Språk */}
      <Card>
        <CardHeader>
          <CardTitle>{tSettings("languageTitle")}</CardTitle>
          <p className="text-sm text-ink-muted">{tSettings("languageDesc")}</p>
        </CardHeader>
        <CardContent>
          <LocaleSwitcher />
        </CardContent>
      </Card>

      {/* Profil */}
      <Card>
        <CardHeader>
          <CardTitle>{tSettings("profileTitle")}</CardTitle>
          <p className="text-sm text-ink-muted">{tSettings("profileDesc")}</p>
        </CardHeader>
        <CardContent>
          <form
            className="max-w-md space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveProfile();
            }}
          >
            <div>
              <Label htmlFor="name">{tSettings("nameLabel")}</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={12} />
            </div>
            <div>
              <Label htmlFor="email">{tSettings("emailLabel")}</Label>
              <Input id="email" value={user.email} disabled />
            </div>
            <FieldError message={profileError} />
            <Button type="submit" loading={savingProfile}>
              {tSettings("saveProfile")}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Notiser */}
      <Card>
        <CardHeader>
          <CardTitle>{tSettings("notifTitle")}</CardTitle>
          <p className="text-sm text-ink-muted">{tSettings("notifDesc")}</p>
        </CardHeader>
        <CardContent>
          {/* Självgrindande: visar rätt besked för restock, prislarm eller båda. */}
          <RestockPausedBanner className="mb-4" />
          <div className="space-y-4">
            {notificationOptions.map((opt) => {
              // "Alla restocks" är en Pro-förmån OCH en pausad funktion. Under
              // pausen låses den för alla — inklusive den som betalar — eftersom
              // ett påslaget reglage annars påstår att larm är på väg.
              const locked =
                opt.key === "allRestocks" && (!user.isPro || user.restockPaused);
              const pausedOpt = opt.key === "allRestocks" && user.restockPaused;
              return (
                <div key={opt.key} className="flex items-start gap-3">
                  <Checkbox
                    id={`notif-${opt.key}`}
                    checked={settings[opt.key] && !locked}
                    disabled={savingSettings || locked}
                    onChange={(e) => void toggleSetting(opt.key, e.target.checked)}
                  />
                  <label htmlFor={`notif-${opt.key}`} className="cursor-pointer">
                    <span className="block text-sm font-medium text-ink">
                      {opt.label}
                      {pausedOpt ? (
                        <span className="ml-2 text-xs text-holo-gold">{tPause("tag")}</span>
                      ) : (
                        locked && <span className="ml-2 text-xs text-holo-cyan">{tSettings("proTag")}</span>
                      )}
                    </span>
                    <span className="block text-xs text-ink-muted">{opt.hint}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Premium */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{tSettings("planTitle")}</CardTitle>
          {user.isPro ? (
            <Badge variant="holo">{tSettings("proBadge")}</Badge>
          ) : (
            <Badge>{tSettings("freeBadge")}</Badge>
          )}
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-muted">
            {tSettings(alertCopyKey(user.isPro ? "planProDesc" : "planFreeDesc", pricePaused))}
          </p>
          {/* Gratisperioden visas med SLUTDATUM. Utan datumet upptäcker användaren
              att perioden tagit slut genom att restock-larmen tystnar — vilket läser
              som ett fel i appen, inte som ett utgånget erbjudande. */}
          {user.bonusProUntil && (
            <p className="mt-2 text-sm font-medium text-holo-cyan">
              Gratisperiod till och med{" "}
              {new Date(user.bonusProUntil).toLocaleDateString("sv-SE", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
              .
            </p>
          )}
          {(!user.isPro || user.bonusProUntil) && (
            <LinkButton href="/priser" className="mt-4">
              {user.bonusProUntil ? "Fortsätt med Pro" : tSettings("upgradeCta")}
            </LinkButton>
          )}
        </CardContent>
      </Card>

      {/* Discord */}
      {user.discordEnabled && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <DiscordMark className="h-5 w-5 text-discord" />
              {tSettings("discordTitle")}
            </CardTitle>
            {discordUsername ? (
              <Badge variant="holo">{tSettings("connected")}</Badge>
            ) : (
              <Badge>{tSettings("notConnected")}</Badge>
            )}
          </CardHeader>
          <CardContent>
            <p className="text-sm text-ink-muted">
              {discordUsername
                ? tSettings("discordConnectedDesc", { name: discordUsername })
                : tSettings("discordDisconnectedDesc")}
            </p>
            <div className="mt-4">
              {discordUsername ? (
                <Button
                  variant="secondary"
                  loading={disconnectingDiscord}
                  onClick={() => void disconnectDiscord()}
                >
                  {tSettings("disconnectDiscord")}
                </Button>
              ) : (
                // Vanlig <a>, INTE next/link — samma skäl som Tradera nedan: en
                // OAuth-omdirigering till discord.com måste vara en riktig
                // sidnavigering, klientroutingen kan inte hantera den.
                <a
                  href="/api/discord/connect"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-discord px-4 text-sm font-semibold text-white transition-all duration-200 ease-out hover:bg-discord-hover active:scale-[0.97]"
                >
                  <DiscordMark className="h-4 w-4" />
                  {tSettings("connectDiscord")}
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tradera */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <TraderaMark className="h-5 w-5 text-tradera" />
            {tSettings("traderaTitle")}
          </CardTitle>
          {traderaUserId ? <Badge variant="holo">{tSettings("connected")}</Badge> : <Badge>{tSettings("notConnected")}</Badge>}
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-muted">
            {traderaUserId
              ? tSettings("traderaConnectedDesc", { id: traderaUserId })
              : tSettings("traderaDisconnectedDesc")}
          </p>
          <div className="mt-4">
            {traderaUserId ? (
              <Button variant="secondary" loading={disconnectingTradera} onClick={() => void disconnectTradera()}>
                {tSettings("disconnectTradera")}
              </Button>
            ) : (
              // Vanlig <a>, INTE next/link: måste vara en riktig sidnavigering (cookie +
              // 307 till tradera.com) — Next Links klientrouting kan inte hantera det.
              // Traderas gula (inte appens turkos) av samma skäl som Discord-kortet
              // ovanför: kortet identifierar en ANNAN tjänst. `text-surface` = svart
              // text, för gult är en ljus yta där vit text faller under kontrastkravet.
              <a
                href="/api/tradera/connect"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-tradera px-4 text-sm font-semibold text-surface transition-all duration-200 ease-out hover:bg-tradera-hover active:scale-[0.97]"
              >
                <TraderaMark className="h-4 w-4" />
                {tSettings("connectTradera")}
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Konto / GDPR */}
      <Card className="border-fall/30">
        <CardHeader>
          <CardTitle>{tSettings("gdprTitle")}</CardTitle>
          <p className="text-sm text-ink-muted">
            {tSettings("gdprDesc")}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() =>
                downloadFromApi("/api/users/me/export", "foilio-data.json").catch(() =>
                  toast({ title: tSettings("genericFail"), variant: "error" }),
                )
              }
            >
              {tSettings("exportData")}
            </Button>
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              {tSettings("deleteAccount")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Radera konto-modal */}
      <Modal
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setConfirmText("");
        }}
        title={tSettings("deleteModalTitle")}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteOpen(false);
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
              {tSettings("deleteConfirmBtn")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            {tSettings.rich("deleteWarning", {
              b: (chunks) => <span className="font-semibold text-fall">{chunks}</span>,
            })}
          </p>
          <div>
            <Label htmlFor="confirmDelete">
              {tSettings.rich("deleteConfirmPrompt", {
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
    </div>
  );
}
