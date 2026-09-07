"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import { IconArrowRight } from "@/components/ui/icons";
import {
  fetchMessages,
  invalidateUnreadCache,
  markConversationRead,
  postMessage,
  recallMessages,
  rememberMessages,
  useChatStream,
  type ChatUserDto,
  type MessageDto,
} from "@/lib/chat-client";
import {
  MESSAGES_PAGE_MAX,
  MESSAGE_MAX_CHARS,
  dayLabelFor,
  isSameLocalDay,
  mergeMessages,
  validateMessageBody,
} from "@/lib/chat-rules";
import { localeTag } from "./conversation-list";

// Next SSR-renderar även klientkomponenter; useLayoutEffect varnar då på servern.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface ConversationViewProps {
  conversationId: string;
  meId: string;
  other: ChatUserDto | null;
  initialMessages: MessageDto[];
  /** Motpartens lastReadAt (ISO) — "Läst" under mitt sista meddelande. */
  initialOtherReadAt: string | null;
  /** Skrivfältet ersätts av beskedet när det är satt. */
  composerNotice: string | null;
}

/** Hur nära botten (px) man får vara för att nya meddelanden ska dra med sig vyn. */
const STICK_THRESHOLD_PX = 80;
const COMPOSER_MAX_PX = 160;
/** Tangentbordets egen kurva och tid (iOS ~0,25 s). */
const KEYBOARD_EASE = "cubic-bezier(0.17, 0.59, 0.4, 1)";
const KEYBOARD_MS = 250;
/**
 * Bara rutförändringar i tangentbordsklass glider. Skrivfältet växer med ~20 px
 * per rad medan man skriver — den rörelsen ska vara omedelbar, inte animerad.
 */
const GLIDE_MIN_PX = 80;

/**
 * Flyttar `el` till `from` px och låter det glida tillbaka till 0. Layouten är
 * alltså redan färdig (höjden sattes på en bildruta) och SJÄLVA RÖRELSEN körs som
 * en transform, dvs på kompositorn — att i stället övergå höjden gav en layout-
 * och målningsrunda per bildruta och kändes hackig i WebView:en.
 */
function glide(el: HTMLElement | null, from: number) {
  if (!el || from === 0) return;
  el.style.transition = "none";
  el.style.transform = `translate3d(0, ${from}px, 0)`;
  void el.offsetHeight; // tvinga fram startläget innan övergången sätts på
  el.style.transition = `transform ${KEYBOARD_MS}ms ${KEYBOARD_EASE}`;
  el.style.transform = "translate3d(0, 0, 0)";
}

export function ConversationView({
  conversationId,
  meId,
  other,
  initialMessages,
  initialOtherReadAt,
  composerNotice,
}: ConversationViewProps) {
  const t = useTranslations("Chat");
  const locale = useLocale();
  const { toast } = useToast();

  // Serverns första sida + det vyn redan sett (se rememberMessages): utan det
  // saknades ett nyss skickat meddelande i 30 s när man gick ut och in igen,
  // eftersom Nexts klient-routercache serverade samma RSC-nyttolast.
  const [messages, setMessages] = useState<MessageDto[]>(() =>
    mergeMessages(recallMessages(conversationId), initialMessages)
  );
  const [otherReadAt, setOtherReadAt] = useState<string | null>(initialOtherReadAt);
  const [hasOlder, setHasOlder] = useState(initialMessages.length >= MESSAGES_PAGE_MAX);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(true);
  const [timeFor, setTimeFor] = useState<string | null>(null);
  // Enter skickar bara med en riktig tangentbordsmus (desktop); på touch är
  // Enter radbrytning — där finns skicka-knappen.
  const [enterSends, setEnterSends] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const listHeightRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const forceScrollRef = useRef(true);
  const prependRef = useRef<number | null>(null);
  const pendingReadRef = useRef(false);
  const lastIdRef = useRef<string | null>(initialMessages[initialMessages.length - 1]?.id ?? null);

  useEffect(() => {
    setEnterSends(window.matchMedia("(pointer: fine)").matches);
  }, []);

  const fmtTime = useMemo(
    () => new Intl.DateTimeFormat(localeTag(locale), { hour: "2-digit", minute: "2-digit" }),
    [locale]
  );
  const fmtDay = useMemo(
    () => new Intl.DateTimeFormat(localeTag(locale), { day: "numeric", month: "long" }),
    [locale]
  );
  const fmtDayYear = useMemo(
    () =>
      new Intl.DateTimeFormat(localeTag(locale), { day: "numeric", month: "long", year: "numeric" }),
    [locale]
  );

  // ---------- läst ----------
  const markRead = useCallback(() => {
    invalidateUnreadCache();
    markConversationRead(conversationId).catch(() => undefined);
  }, [conversationId]);

  useEffect(() => {
    markRead();
  }, [markRead]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && pendingReadRef.current) {
        pendingReadRef.current = false;
        markRead();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  const readIncoming = useCallback(() => {
    if (document.visibilityState === "visible") markRead();
    else pendingReadRef.current = true;
  }, [markRead]);

  // ---------- strömmen ----------
  useChatStream(true, {
    onMessage: (cid, m) => {
      if (cid !== conversationId) {
        // Något annat samtal fick ett meddelande → badgen är inaktuell.
        invalidateUnreadCache();
        return;
      }
      setMessages((prev) => mergeMessages(prev, [m]));
      if (m.senderId !== meId) readIncoming();
    },
    onRead: (cid, userId, readAt) => {
      if (cid === conversationId && other && userId === other.id) setOtherReadAt(readAt);
    },
    onReconnect: () => {
      const last = lastIdRef.current;
      if (!last) return;
      fetchMessages(conversationId, { after: last })
        .then((rows) => {
          if (rows.length === 0) return;
          setMessages((prev) => mergeMessages(prev, rows));
          if (rows.some((r) => r.senderId !== meId)) readIncoming();
        })
        .catch(() => undefined);
    },
    onStatus: setConnected,
  });

  useEffect(() => {
    lastIdRef.current = messages[messages.length - 1]?.id ?? null;
    rememberMessages(conversationId, messages);
  }, [conversationId, messages]);

  // ---------- scroll ----------
  useIsoLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (prependRef.current != null) {
      // Äldre sida lades till överst: håll kvar det man tittade på.
      el.scrollTop += el.scrollHeight - prependRef.current;
      prependRef.current = null;
      return;
    }
    if (forceScrollRef.current || stickRef.current) {
      el.scrollTop = el.scrollHeight;
      forceScrollRef.current = false;
    }
  }, [messages]);

  // Tangentbordet krymper rutan (conversation-screen sätter höjden på EN
  // bildruta). Två saker måste hända då:
  //   1. Stod man vid botten ska man stå kvar där — annars glider de nedersta
  //      meddelandena ut under skrivfältet och kommer tillbaka först vid nästa.
  //   2. Rörelsen ska SES. Skrivfältet flyttade sig hela vägen på en bildruta;
  //      nu startar det (och bubblorna, exakt så långt som pinningen faktiskt
  //      rullade) i sitt gamla läge och glider på plats med en transform.
  // ⛔ Mät rörelsen HÄR, i ResizeObserver:n: en effekt på tangentbordshöjden
  // körs innan skalets egen effekt hunnit sätta den nya höjden och skulle mäta
  // gårdagens ruta.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ro = new ResizeObserver(() => {
      const height = el.clientHeight;
      const prev = listHeightRef.current;
      listHeightRef.current = height;
      const before = el.scrollTop;
      if (stickRef.current) el.scrollTop = el.scrollHeight;
      if (reduce || prev == null) return;
      const delta = prev - height;
      if (Math.abs(delta) < GLIDE_MIN_PX) return;
      glide(composerRef.current, delta);
      glide(contentRef.current, el.scrollTop - before);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function onListScroll() {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }

  async function loadOlder() {
    const first = messages[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const rows = await fetchMessages(conversationId, { before: first.id });
      setHasOlder(rows.length >= MESSAGES_PAGE_MAX);
      if (rows.length > 0) {
        prependRef.current = listRef.current?.scrollHeight ?? null;
        setMessages((prev) => mergeMessages(rows, prev));
      }
    } catch {
      // knappen finns kvar — nästa tryck försöker igen
    } finally {
      setLoadingOlder(false);
    }
  }

  // ---------- skriv ----------
  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
  }

  async function send() {
    const validated = validateMessageBody(draft);
    if (!validated.ok || sending || composerNotice) return;
    const text = draft;
    setDraft("");
    setSending(true);
    requestAnimationFrame(autoGrow);
    try {
      const m = await postMessage(conversationId, validated.body);
      forceScrollRef.current = true;
      setMessages((prev) => mergeMessages(prev, [m]));
    } catch (err) {
      setDraft(text);
      toast({
        title: t("sendFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && enterSends && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  // ---------- render ----------
  const lastMine = [...messages].reverse().find((m) => m.senderId === meId) ?? null;
  const lastMineRead =
    lastMine != null &&
    otherReadAt != null &&
    new Date(otherReadAt).getTime() >= new Date(lastMine.createdAt).getTime();

  const now = new Date();
  const items: JSX.Element[] = [];
  let prevDate: Date | null = null;
  for (const m of messages) {
    const d = new Date(m.createdAt);
    if (!prevDate || !isSameLocalDay(prevDate, d)) {
      const label = dayLabelFor(d, now);
      const text =
        label.kind === "today"
          ? t("today")
          : label.kind === "yesterday"
            ? t("yesterday")
            : (d.getFullYear() === now.getFullYear() ? fmtDay : fmtDayYear).format(d);
      items.push(
        <div key={`day-${m.id}`} className="my-3 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-surface-border" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{text}</span>
          <span className="h-px flex-1 bg-surface-border" />
        </div>
      );
    }
    prevDate = d;
    const mine = m.senderId === meId;
    const deleted = m.senderId === null;
    const time = fmtTime.format(d);
    const showTime = timeFor === m.id;
    items.push(
      <div key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
        {deleted && <span className="mb-0.5 px-1 text-[11px] italic text-ink-faint">{t("deletedAccount")}</span>}
        <button
          type="button"
          onClick={() => setTimeFor((cur) => (cur === m.id ? null : m.id))}
          title={time}
          className={cn(
            "group max-w-[82%] rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed text-ink",
            "whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
            mine
              ? "rounded-br-md bg-holo-cyan/15 hover:bg-holo-cyan/20"
              : "rounded-bl-md border border-surface-border bg-surface-raised hover:bg-surface-overlay/40"
          )}
        >
          {m.body}
        </button>
        {(showTime || (mine && m.id === lastMine?.id)) && (
          <span className="mt-0.5 px-1 text-[11px] tabular-nums text-ink-faint">
            {showTime && <time dateTime={m.createdAt}>{time}</time>}
            {showTime && mine && m.id === lastMine?.id && " · "}
            {mine && m.id === lastMine?.id && (lastMineRead ? t("read") : t("sent"))}
          </span>
        )}
      </div>
    );
  }

  const canSend = validateMessageBody(draft).ok && !sending && !composerNotice;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={onListScroll}
        // ⛔ Bubblorna ligger mot TOPPEN (ägarbeslut 2026-09-07) — ett kort samtal
        // ska inte hänga längst ner med en svart rymd ovanför. Det förutsätter att
        // tangentbordet krymper rutan nedifrån i stället för att skjuta innehållet
        // uppåt; se conversation-screen.tsx.
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-3"
      >
        <div ref={contentRef}>
          {hasOlder && (
            <div className="mb-2 flex justify-center">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="rounded-full border border-surface-border px-3 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-overlay hover:text-ink disabled:opacity-50"
              >
                {loadingOlder ? <Spinner size="sm" /> : t("loadOlder")}
              </button>
            </div>
          )}
          {messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-muted">{t("noMessages")}</p>
          ) : (
            <div className="flex flex-col gap-1.5">{items}</div>
          )}
        </div>
      </div>

      {/* Skrivfältet är det som RÖR SIG när tangentbordet kommer upp — glide()
          ovan startar det i sitt gamla läge och låter det glida på plats. */}
      <div ref={composerRef} className="shrink-0">
        {!connected && (
          <p className="pb-1 text-center text-[11px] text-ink-faint" role="status">
            {t("reconnecting")}
          </p>
        )}

        {composerNotice ? (
          <p className="rounded-xl border border-surface-border px-4 py-3 text-center text-sm text-ink-muted">
            {composerNotice}
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-end gap-2 border-t border-surface-border pt-2"
          >
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                autoGrow();
              }}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={MESSAGE_MAX_CHARS}
              placeholder={t("composerPlaceholder")}
              aria-label={t("composerPlaceholder")}
              enterKeyHint={enterSends ? "send" : "enter"}
              className="max-h-40 min-h-[42px] flex-1 resize-none rounded-2xl border border-surface-border bg-surface-raised px-4 py-2.5 text-base text-ink placeholder:text-ink-faint focus:border-holo-cyan focus:outline-none focus:ring-2 focus:ring-holo-cyan/30 sm:text-sm"
            />
            <button
              type="submit"
              disabled={!canSend}
              aria-label={t("send")}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-holo-cyan text-surface transition-all active:scale-95 disabled:opacity-40"
            >
              {sending ? <Spinner size="sm" className="text-current" /> : <IconArrowRight size={20} />}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
