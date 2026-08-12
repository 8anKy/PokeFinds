"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Checkbox } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import type { CreatorCodeStats } from "@/services/creator-codes";

const nf = new Intl.NumberFormat("sv-SE");
const df = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short" });

interface Props {
  rows: CreatorCodeStats[];
  appUrl: string;
}

const EMPTY_FORM = {
  code: "",
  creatorName: "",
  channel: "",
  stripePromotionCodeId: "",
  note: "",
};

export function CreatorCodesClient({ rows, appUrl }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Länken kreatören lägger i sin bio. Landar på webben, aldrig i appbutiken. */
  const linkFor = (code: string) => `${appUrl}/?ref=${code}`;

  async function copyLink(code: string) {
    try {
      await navigator.clipboard.writeText(linkFor(code));
      toast({ title: "Länken kopierad", description: linkFor(code), variant: "success" });
    } catch {
      toast({ title: "Kunde inte kopiera", variant: "error" });
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/creator-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          creatorName: form.creatorName,
          channel: form.channel || undefined,
          stripePromotionCodeId: form.stripePromotionCodeId || undefined,
          note: form.note || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Något gick fel.");
      toast({ title: "Kod skapad", description: data.code, variant: "success" });
      setForm(EMPTY_FORM);
      router.refresh();
    } catch (err) {
      toast({
        title: "Kunde inte skapa koden",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  /**
   * ⛔ Radering är STÄDNING (felstavningar, testrader), inte "avsluta samarbetet".
   * Servern nekar koder som värvat konton — attributionen är utbetalningsunderlaget
   * och går inte att återskapa. Avsluta ett samarbete med Aktiv-rutan i stället.
   */
  async function remove(row: CreatorCodeStats) {
    const warning =
      `Radera ${row.code} permanent?\n\n` +
      "Koden försvinner och länken slutar attribuera — tyst, utan felmeddelande för " +
      "den som klickar. Ska samarbetet bara avslutas: stäng av Aktiv i stället.";
    if (!confirm(warning)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/creator-codes/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Något gick fel.");
      toast({ title: "Koden raderad", description: row.code, variant: "success" });
      router.refresh();
    } catch (err) {
      toast({
        title: "Kunde inte radera koden",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(row: CreatorCodeStats) {
    setBusyId(row.id);
    try {
      const res = await fetch("/api/admin/creator-codes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, isActive: !row.isActive }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Något gick fel.");
      router.refresh();
    } catch (err) {
      toast({
        title: "Kunde inte uppdatera",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  const totalSignups = rows.reduce((n, r) => n + r.signups, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-bold text-ink">Kreatörer</h1>
        <p className="mt-1 text-sm text-ink-muted">
          En kod per betalt samarbete. <strong className="text-ink">Konton</strong> räknar alla som
          registrerat sig via kreatörens länk — oavsett om de köpt Pro. Det är siffran du betalar på.
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          Rabatten gäller bara webbkassan. Köp i app:en går via App Store/Google Play, som har egna
          rabattsystem — skicka därför alltid kreatörstrafiken till länken nedan, inte till butiken.
        </p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="cc-code">Kod</Label>
              <Input
                id="cc-code"
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="EMMA"
                autoCapitalize="characters"
              />
              <p className="mt-1 text-xs text-ink-faint">
                Blir versaler automatiskt. Går inte att ändra efteråt.
              </p>
            </div>
            <div>
              <Label htmlFor="cc-name">Kreatör</Label>
              <Input
                id="cc-name"
                required
                value={form.creatorName}
                onChange={(e) => setForm({ ...form, creatorName: e.target.value })}
                placeholder="Emma Andersson"
              />
            </div>
            <div>
              <Label htmlFor="cc-channel">Kanal</Label>
              <Input
                id="cc-channel"
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
                placeholder="@emma på TikTok"
              />
            </div>
            <div>
              <Label htmlFor="cc-promo">Stripe promotion code-ID</Label>
              <Input
                id="cc-promo"
                value={form.stripePromotionCodeId}
                onChange={(e) => setForm({ ...form, stripePromotionCodeId: e.target.value })}
                placeholder="promo_1A2b3C…"
              />
              <p className="mt-1 text-xs text-ink-faint">
                Valfritt. Tomt = koden spårar bara, utan rabatt.
              </p>
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <Label htmlFor="cc-note">Anteckning</Label>
              <Input
                id="cc-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="2 000 kr + 15 %, kampanj v. 34"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" loading={saving} className="w-full sm:w-auto">
                Skapa kod
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title="Inga kreatörskoder ännu"
          description="Skapa en kod per samarbete. Kreatören delar länken, och varje konto som skapas via den hamnar här."
        />
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            {nf.format(rows.length)} koder · {nf.format(totalSignups)} konton totalt
          </p>
          <Table>
            <THead>
              <TR>
                <TH>Kod</TH>
                <TH>Kreatör</TH>
                <TH className="text-right">Konton</TH>
                <TH className="text-right">Pro nu</TH>
                <TH className="text-right">Varav Stripe</TH>
                <TH className="text-right">Senaste</TH>
                <TH>Rabatt</TH>
                <TH className="text-right">Åtgärd</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} className={r.isActive ? undefined : "opacity-60"}>
                  <TD>
                    <button
                      type="button"
                      onClick={() => copyLink(r.code)}
                      title={`Kopiera ${linkFor(r.code)}`}
                      className="font-mono font-semibold text-holo-cyan hover:underline"
                    >
                      {r.code}
                    </button>
                    {!r.isActive && (
                      <Badge variant="default" className="ml-2">
                        Avstängd
                      </Badge>
                    )}
                  </TD>
                  <TD>
                    <span className="text-ink">{r.creatorName}</span>
                    {r.channel && (
                      <span className="block text-xs text-ink-faint">{r.channel}</span>
                    )}
                  </TD>
                  <TD className="text-right font-semibold tabular-nums text-ink">
                    {nf.format(r.signups)}
                  </TD>
                  <TD className="text-right tabular-nums text-ink-muted">{nf.format(r.proNow)}</TD>
                  <TD className="text-right tabular-nums text-ink-muted">
                    {nf.format(r.stripeNow)}
                  </TD>
                  <TD className="text-right text-xs text-ink-faint">
                    {r.lastSignupAt ? df.format(r.lastSignupAt) : "–"}
                  </TD>
                  <TD>
                    {r.stripePromotionCodeId ? (
                      <Badge variant="success">Förifylls</Badge>
                    ) : (
                      <span className="text-xs text-ink-faint">Ingen</span>
                    )}
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-3">
                      <Checkbox
                        id={`active-${r.id}`}
                        checked={r.isActive}
                        disabled={busyId === r.id}
                        onChange={() => toggleActive(r)}
                        label="Aktiv"
                      />
                      {/* Bara koder utan värvade konton går att radera — servern är
                          facit, knappen döljs här så vägen inte ens erbjuds. */}
                      {r.signups === 0 && (
                        <button
                          type="button"
                          onClick={() => remove(r)}
                          disabled={busyId === r.id}
                          className="text-sm text-ink-faint transition-colors hover:text-fall disabled:opacity-50"
                        >
                          Radera
                        </button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </div>
  );
}
