"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuthHint } from "@/lib/auth-hint";
import { apiFetch } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { fetchPersonalState, invalidatePersonalState } from "./use-forum-viewer";

/**
 * FORUMETS REGLER — dialogen som möter en inloggad användare första gången hen
 * kommer in i forumet (ägarbeslut 2026-09-05, "like Collectr"). Godkänner hen
 * sparas det på kontot (`User.forumRulesAcceptedAt`) och dialogen kommer aldrig
 * tillbaka, på någon enhet. "Inte nu" lämnar forumet; kryss/overlay stänger BARA
 * dialogen (ägaren 2026-09-05: ett tryck på tabbaren träffade overlayn och kastade
 * en till Utforska i stället för den valda fliken) — skrivningarna är ändå spärrade
 * tills reglerna är godkända, så dialogen kommer tillbaka vid nästa försök.
 *
 * ⛔ Dialogen är BEKVÄMLIGHET — regeln bor på servern (lib/forum-rules.ts): en
 * tråd eller ett svar från ett konto som inte godkänt får 403 + `FORUM_RULES`,
 * och skrivkomponenterna ber då den här dialogen öppna sig via
 * `requestForumRules()`. Utloggade ser ingen dialog: läsning är fri, och den
 * som loggar in för att skriva får frågan då.
 *
 * KOSTNAD: en logged-in besökare gör redan /api/community/me per forumsida
 * (gilla/spara-läge); svaret bär `rulesAccepted` sedan 2026-09-05. Ett
 * godkännande minns i sessionStorage så att sidbyten inte frågar igen.
 */
const EVENT = "foilio:forum-rules";
const SESSION_KEY = "foilio:forumRulesOk";

/** Skrivkomponenterna anropar den här när servern svarat FORUM_RULES. */
export function requestForumRules(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT));
}

function rememberAccepted(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* privat läge m.m. — då frågar vi servern nästa gång, det är allt */
  }
}

function remembered(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function ForumRulesGate() {
  const t = useTranslations("Forum");
  const router = useRouter();
  const { toast } = useToast();
  const loggedIn = useAuthHint();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onRequest = () => setOpen(true);
    window.addEventListener(EVENT, onRequest);
    return () => window.removeEventListener(EVENT, onRequest);
  }, []);

  useEffect(() => {
    if (!loggedIn || remembered()) return;
    let cancelled = false;
    void fetchPersonalState([]).then((state) => {
      if (cancelled) return;
      if (state.rulesAccepted === false) setOpen(true);
      else if (state.rulesAccepted === true) rememberAccepted();
    });
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

  const accept = useCallback(async () => {
    setBusy(true);
    try {
      await apiFetch("/api/community/rules", { method: "POST" });
      rememberAccepted();
      invalidatePersonalState();
      setOpen(false);
    } catch (e) {
      toast({
        title: t("rulesAcceptFailed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }, [t, toast]);

  // Inget X och ingen stängning via bakgrund/Escape (ägarbeslut 2026-09-06): ett
  // kryss som lämnade användaren kvar i forumet läste som en tredje, oförklarad
  // väg. Valet är "Inte nu" (tillbaka till start) eller "Jag godkänner".
  const decline = useCallback(() => {
    setOpen(false);
    router.push("/");
  }, [router]);

  return (
    <Modal
      open={open}
      onClose={decline}
      dismissible={false}
      title={t("rulesTitle")}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={decline} disabled={busy}>
            {t("rulesDecline")}
          </Button>
          <Button onClick={() => void accept()} loading={busy}>
            {t("rulesAccept")}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-ink-muted">{t("rulesIntro")}</p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink">
        <li>{t("rules1")}</li>
        <li>{t("rules2")}</li>
        <li>{t("rules3")}</li>
        <li>{t("rules4")}</li>
        <li>{t("rules5")}</li>
      </ol>
      <p className="mt-4 text-xs text-ink-faint">
        {t.rich("rulesLegal", {
          terms: (chunks) => (
            <Link href="/villkor" className="underline hover:text-holo-cyan" target="_blank">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link
              href="/integritetspolicy"
              className="underline hover:text-holo-cyan"
              target="_blank"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
    </Modal>
  );
}
