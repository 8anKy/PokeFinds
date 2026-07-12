"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { signOut } from "next-auth/react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { setAuthHint } from "@/lib/auth-hint";
import { apiFetch } from "@/lib/client-api";
import { enablePush } from "@/lib/push-client";
import { useToast } from "@/components/ui/toast";
import { Button, LinkButton } from "@/components/ui/button";
import { downloadFromApi } from "@/lib/download";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input, Label, Checkbox, FieldError } from "@/components/ui/input";

export interface NotificationSettings {
  email: boolean;
  push: boolean;
  allRestocks: boolean;
}

export interface SettingsUser {
  name: string;
  email: string;
  bio: string | null;
  planTier: "FREE" | "PREMIUM";
  /** Pro-förmåner (planTier ELLER admin-roll) — grinda features på denna, ej planTier. */
  isPro: boolean;
  notificationSettings: NotificationSettings;
  traderaUserId: string | null;
}

export function SettingsClient({ user }: { user: SettingsUser }) {
  const { toast } = useToast();
  const tSettings = useTranslations("Settings");
  const tc = useTranslations("Common");
  const deleteWord = tSettings("deleteWord");
  const router = useRouter();
  const searchParams = useSearchParams();

  // Tradera-koppling
  const [traderaUserId, setTraderaUserId] = useState(user.traderaUserId);
  const [disconnectingTradera, setDisconnectingTradera] = useState(false);

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
    { key: "email", label: tSettings("notifEmail"), hint: tSettings("notifEmailHint") },
    { key: "allRestocks", label: tSettings("notifAll"), hint: tSettings("notifAllHint") },
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
          <div className="space-y-4">
            {notificationOptions.map((opt) => {
              // "Alla restocks" är en Pro-förmån.
              const locked = opt.key === "allRestocks" && !user.isPro;
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
                      {locked && <span className="ml-2 text-xs text-holo-cyan">{tSettings("proTag")}</span>}
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
            {user.isPro ? tSettings("planProDesc") : tSettings("planFreeDesc")}
          </p>
          {!user.isPro && (
            <LinkButton href="/priser" className="mt-4">
              {tSettings("upgradeCta")}
            </LinkButton>
          )}
        </CardContent>
      </Card>

      {/* Tradera */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{tSettings("traderaTitle")}</CardTitle>
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
              <a
                href="/api/tradera/connect"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-holo-cyan px-4 text-sm font-semibold text-surface transition-all duration-200 ease-out hover:bg-holo-cyan/90 hover:shadow-glow active:scale-[0.97] active:bg-holo-cyan/80"
              >
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
