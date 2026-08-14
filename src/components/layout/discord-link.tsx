import { DISCORD_URL } from "@/lib/social-links";
import { IconDiscord } from "@/components/ui/brand-icons";

/**
 * Discord-knappen i headern, bredvid App Store-brickan.
 *
 * Låg den bara i sidfoten och på /mer syntes den nästan aldrig: appens användare
 * bor i Utforska, och /mer är en inställningssida man öppnar när något krånglar.
 * Headern är den enda ytan som följer med överallt.
 *
 * ⛔ Till skillnad från `AppStoreBadge` döljer den sig INTE i native-appen — att
 * be en app-användare ladda ned appen är brus, men communityn är lika relevant
 * där. Därför ingen Capacitor-koll, och därmed heller ingen "use client".
 *
 * Etiketten visas först på lg (samma brytpunkt som brickan): på mobilen delar
 * headern plats med logotyp och kontoknapp, och glyfen bär igenkänningen själv.
 */
export function DiscordLink() {
  return (
    <a
      href={DISCORD_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Foilio på Discord"
      title="Foilio på Discord"
      className="inline-flex items-center gap-2 rounded-xl border border-surface-border bg-surface-raised px-2.5 py-1.5 text-ink-muted transition-colors hover:border-holo-cyan/50 hover:text-ink lg:px-3.5"
    >
      <IconDiscord size={20} className="shrink-0" />
      <span className="hidden text-sm font-semibold lg:inline">Discord</span>
    </a>
  );
}
