"use client";

import { useEffect, useState } from "react";
import { useAuthHint } from "@/lib/auth-hint";
import { getSharedSession } from "@/lib/client-session";

/**
 * Betraktarens tillstånd på forumets ISR-sidor: vem hen är (ur den delade
 * sessionen) och vad hen gillat/sparat/gått med i/blockerat (`/api/community/me`).
 *
 * ⛔ Anropar INGENTING förrän `fo_auth`-hinten säger att någon är inloggad —
 * utloggade besökare (och crawlers) ska aldrig väcka databasen från en cachad
 * sida. Svaret delas mellan komponenterna på samma sida via ett modul-löfte,
 * så trådens åtgärdsrad och svarslistan gör EN hämtning tillsammans.
 */
export interface ForumViewer {
  id: string;
  name: string;
  role: string;
}

export interface ForumPersonalState {
  likedIds: string[];
  savedIds: string[];
  joinedGroupIds: string[];
  blockedIds: string[];
}

const EMPTY: ForumPersonalState = { likedIds: [], savedIds: [], joinedGroupIds: [], blockedIds: [] };
const TTL_MS = 30_000;
const MODERATOR_ROLES = new Set(["MODERATOR", "ADMIN", "SUPERADMIN"]);

let cache: { key: string; at: number; promise: Promise<ForumPersonalState> } | null = null;

export function fetchPersonalState(postIds: string[]): Promise<ForumPersonalState> {
  const key = postIds.join(",");
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = fetch(`/api/community/me${key ? `?postIds=${encodeURIComponent(key)}` : ""}`, {
    credentials: "include",
  })
    .then((r) => (r.ok ? (r.json() as Promise<ForumPersonalState>) : EMPTY))
    .catch(() => EMPTY);
  cache = { key, at: Date.now(), promise };
  return promise;
}

/** Efter en skrivning (gå med, gilla…) — nästa läsning frågar servern igen. */
export function invalidatePersonalState(): void {
  cache = null;
}

export function useForumViewer(postIds: string[]) {
  const loggedIn = useAuthHint();
  const [viewer, setViewer] = useState<ForumViewer | null>(null);
  const [state, setState] = useState<ForumPersonalState>(EMPTY);
  const [ready, setReady] = useState(false);
  const key = postIds.join(",");

  useEffect(() => {
    if (loggedIn === null) return;
    if (!loggedIn) {
      setViewer(null);
      setState(EMPTY);
      setReady(true);
      return;
    }
    let cancelled = false;
    void Promise.all([getSharedSession(), fetchPersonalState(key ? key.split(",") : [])]).then(
      ([session, personal]) => {
        if (cancelled) return;
        const u = session?.user;
        setViewer(u ? { id: u.id, name: u.name, role: u.role } : null);
        setState(personal);
        setReady(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [loggedIn, key]);

  return {
    /** null = före mount (okänt), annars fo_auth-hinten. */
    loggedIn,
    viewer,
    state,
    setState,
    ready,
    isModerator: viewer ? MODERATOR_ROLES.has(viewer.role) : false,
  };
}
