"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { apiFetch } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input, Textarea, Label, Checkbox, FieldError } from "@/components/ui/input";

export interface NotificationSettings {
  email: boolean;
  inApp: boolean;
  push: boolean;
  weeklyReport: boolean;
}

export interface SettingsUser {
  name: string;
  email: string;
  bio: string | null;
  planTier: "FREE" | "PREMIUM";
  notificationSettings: NotificationSettings;
}

export function SettingsClient({ user }: { user: SettingsUser }) {
  const { toast } = useToast();

  // Profil
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Notiser
  const [settings, setSettings] = useState<NotificationSettings>(user.notificationSettings);
  const [savingSettings, setSavingSettings] = useState(false);

  // Radera konto
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function saveProfile() {
    if (name.trim().length < 2) {
      setProfileError("Namnet måste vara minst 2 tecken.");
      return;
    }
    setSavingProfile(true);
    setProfileError(null);
    try {
      await apiFetch("/api/users/me", {
        method: "PATCH",
        body: { name: name.trim(), bio: bio.trim() || null },
      });
      toast({ title: "Profilen har sparats", variant: "success" });
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "Något gick fel.");
    } finally {
      setSavingProfile(false);
    }
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
      toast({ title: "Notisinställningarna har sparats", variant: "success" });
    } catch (e) {
      setSettings(previous);
      toast({
        title: "Det gick inte att spara",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function deleteAccount() {
    if (confirmText !== "RADERA") return;
    setDeleting(true);
    try {
      await apiFetch("/api/users/me", { method: "DELETE" });
      toast({ title: "Ditt konto har raderats", variant: "success" });
      await signOut({ callbackUrl: "/" });
    } catch (e) {
      toast({
        title: "Det gick inte att radera kontot",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
      setDeleting(false);
    }
  }

  const notificationOptions: { key: keyof NotificationSettings; label: string; hint: string }[] = [
    { key: "email", label: "E-postnotiser", hint: "Prislarm och restocks via e-post." },
    { key: "inApp", label: "Notiser i appen", hint: "Visas i klockan uppe till höger." },
    { key: "push", label: "Pushnotiser", hint: "Direkt till din enhet (kommer snart)." },
    { key: "weeklyReport", label: "Veckorapport", hint: "Sammanfattning av din samling varje vecka." },
  ];

  return (
    <div className="space-y-6">
      {/* Profil */}
      <Card>
        <CardHeader>
          <CardTitle>Profil</CardTitle>
          <p className="text-sm text-ink-muted">Så här visas du för andra samlare.</p>
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
              <Label htmlFor="name">Namn</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <div>
              <Label htmlFor="email">E-post</Label>
              <Input id="email" value={user.email} disabled />
            </div>
            <div>
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                placeholder="Berätta vad du samlar på…"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={500}
              />
            </div>
            <FieldError message={profileError} />
            <Button type="submit" loading={savingProfile}>
              Spara profil
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Notiser */}
      <Card>
        <CardHeader>
          <CardTitle>Notiser</CardTitle>
          <p className="text-sm text-ink-muted">Välj hur du vill bli larmad.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {notificationOptions.map((opt) => (
              <div key={opt.key} className="flex items-start gap-3">
                <Checkbox
                  id={`notif-${opt.key}`}
                  checked={settings[opt.key]}
                  disabled={savingSettings}
                  onChange={(e) =>
                    void saveNotificationSettings({ ...settings, [opt.key]: e.target.checked })
                  }
                />
                <label htmlFor={`notif-${opt.key}`} className="cursor-pointer">
                  <span className="block text-sm font-medium text-ink">{opt.label}</span>
                  <span className="block text-xs text-ink-muted">{opt.hint}</span>
                </label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Premium */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Plan</CardTitle>
          {user.planTier === "PREMIUM" ? (
            <Badge variant="holo">Premium</Badge>
          ) : (
            <Badge>Gratis</Badge>
          )}
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-muted">
            {user.planTier === "PREMIUM"
              ? "Du har Premium — tack för att du stöttar PokeFinds! Obegränsade bevakningar och full prishistorik."
              : "Med Premium får du obegränsade bevakningar, full prishistorik och prioriterade larm."}
          </p>
          {user.planTier === "FREE" && (
            <Button className="mt-4" disabled>
              Uppgradera — kommer snart
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Konto / GDPR */}
      <Card className="border-fall/30">
        <CardHeader>
          <CardTitle>Konto &amp; integritet (GDPR)</CardTitle>
          <p className="text-sm text-ink-muted">
            Din data är din. Exportera allt vi har om dig, eller radera kontot permanent.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/api/users/me/export" variant="secondary">
              Exportera mina data
            </LinkButton>
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              Radera konto
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
        title="Radera konto permanent"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteOpen(false);
                setConfirmText("");
              }}
            >
              Avbryt
            </Button>
            <Button
              variant="danger"
              disabled={confirmText !== "RADERA"}
              loading={deleting}
              onClick={() => void deleteAccount()}
            >
              Radera mitt konto
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            Detta raderar ditt konto, din samling, dina bevakningar och alla inlägg —{" "}
            <span className="font-semibold text-fall">permanent och utan ångerrätt</span>.
          </p>
          <div>
            <Label htmlFor="confirmDelete">
              Skriv <span className="font-mono font-bold">RADERA</span> för att bekräfta
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
