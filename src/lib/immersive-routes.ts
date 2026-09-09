/**
 * Vilka rutter som är IMMERSIVA — sidor där man gått IN i ett enskilt samtal
 * eller en enskild tråd och all skärmyta hör till innehållet.
 *
 * Där döljs bottenflikarna helt: raden är en NAVIGERING mellan appens ytor, och
 * i ett samtal ligger skrivfältet på exakt den plats flikarna annars tar. Vägen
 * ut är sidans egen bakåtcirkel (`BackCircle`) — inte en flik.
 *
 * ⛔ EN lista, inte en flagga per sida: `BottomTabs` läser den för att försvinna
 * OCH `ConversationScreen` för att inte dra av flikarnas 64 px från sin höjd.
 * Glöms det andra stället står skrivfältet och svävar över en tom remsa.
 *
 * Bara DETALJsidorna — listorna (`/meddelanden`, `/forum`) behåller flikarna.
 * Sökvägarna är UTAN locale-prefix (`usePathname` från `@/i18n/navigation`).
 */
const PREFIXES = ["/meddelanden/", "/forum/t/"];

export function hidesBottomTabs(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const p = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  return PREFIXES.some((prefix) => p.startsWith(prefix) && p.length > prefix.length);
}
