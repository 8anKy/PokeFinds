"use client";

/**
 * Vad forumvyerna redan SKRIVIT i den här fliken.
 *
 * ⛔ SAMMA FÄLLA SOM CHATTEN (se `lib/chat-client.ts`): Nexts klient-routercache
 * serverar samma RSC-nyttolast i 30 sekunder, och trådsidan är dessutom
 * ISR-cachad i 300 s. Ett nyss postat svar — eller ett hjärta man just fyllt —
 * försvann därför när man gick ut ur tråden och in igen, och kom tillbaka först
 * när cachen gått ut. Raden var sparad hela tiden; det var LÄSNINGEN som var
 * gammal.
 *
 * Vi minns därför i minnet vad vyn själv skrivit och lägger det ovanpå serverns
 * sida vid montering. ⛔ `router.refresh()` eller en delta-hämtning hade lagt en
 * Neon-läsning på VARJE trådöppning — det här kostar ingenting alls, varken på
 * Neon eller Railway. Kartorna lever i fliken: en omladdning ger ändå en färsk
 * server-render.
 */
import { mergeMessages } from "@/lib/chat-rules";
import type { CommentDto } from "@/services/community";

const MAX_THREADS = 20;
const MAX_OWN_COMMENTS = 20;
const MAX_TOGGLES = 200;

// ---------- Egna svar ----------

const ownComments = new Map<string, CommentDto[]>();

/**
 * ⛔ Bara svar VYN SJÄLV postat minns vi — aldrig serverns rader. Att minnas
 * hela listan hade återuppväckt ett svar en moderator gömt mellan två
 * renderingar; serverns lista är alltid sanningen om andras svar.
 * Optimistiska rader (`temp-`-id) byts mot serverns och minns aldrig.
 */
export function rememberOwnComment(postId: string, comment: CommentDto): void {
  if (comment.id.startsWith("temp-")) return;
  const prev = ownComments.get(postId) ?? [];
  ownComments.delete(postId);
  ownComments.set(postId, [...prev.filter((c) => c.id !== comment.id), comment].slice(-MAX_OWN_COMMENTS));
  trim(ownComments, MAX_THREADS);
}

export function recallOwnComments(postId: string): CommentDto[] {
  return ownComments.get(postId) ?? [];
}

/** Serverns lista + det vyn själv skrivit, utan dubbletter och i tidsordning. */
export function mergeComments(existing: CommentDto[], incoming: CommentDto[]): CommentDto[] {
  return mergeMessages(existing, incoming);
}

// ---------- Egna växlingar (gilla/spara) ----------

export interface PostToggleMemory {
  liked?: boolean;
  saved?: boolean;
  /** Serverns räknare efter växlingen — trådens ISR-HTML bär en äldre siffra. */
  likeCount?: number;
}

const toggles = new Map<string, PostToggleMemory>();

export function rememberPostToggle(postId: string, patch: PostToggleMemory): void {
  const prev = toggles.get(postId);
  toggles.delete(postId);
  toggles.set(postId, { ...prev, ...patch });
  trim(toggles, MAX_TOGGLES);
}

export function recallPostToggle(postId: string): PostToggleMemory {
  return toggles.get(postId) ?? {};
}

/**
 * Lägger betraktarens EGNA växlingar ovanpå serverns svar. `/api/community/me`
 * cachas 30 s i klienten och sidan är ISR — den som just tryckte vet bäst.
 */
export function applyPostToggles<T extends { likedIds: string[]; savedIds: string[] }>(state: T): T {
  if (toggles.size === 0) return state;
  const liked = new Set(state.likedIds);
  const saved = new Set(state.savedIds);
  for (const [postId, memory] of toggles) {
    if (memory.liked === true) liked.add(postId);
    else if (memory.liked === false) liked.delete(postId);
    if (memory.saved === true) saved.add(postId);
    else if (memory.saved === false) saved.delete(postId);
  }
  return { ...state, likedIds: [...liked], savedIds: [...saved] };
}

function trim(map: Map<string, unknown>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
