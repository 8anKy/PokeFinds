import { useTranslations } from "next-intl";
import { DISCORD_URL } from "@/lib/social-links";
import { IconDiscord } from "@/components/ui/brand-icons";

/**
 * Discord-knappen i headern, TILL VÄNSTER OM NYHETSKNAPPEN (ägarbeslut 2026-10-06;
 * 10-05 satt den bredvid loggan — "konvertera fler till Discord").
 *
 * Låg den bara i sidfoten och på /mer syntes den nästan aldrig: appens användare
 * bor i Utforska, och /mer är en inställningssida man öppnar när något krånglar.
 * Headern är den enda ytan som följer med överallt — även i appen, där mobilens
 * header är samma `SiteHeader` (AppShell renderar den under lg).
 *
 * ⛔ Till skillnad från `AppStoreBadge` döljer den sig INTE i native-appen — att
 * be en app-användare ladda ned appen är brus, men communityn är lika relevant
 * där. Därför ingen Capacitor-koll, och därmed heller ingen "use client".
 *
 * ⛔ LITEN MED FLIT (ägarbeslut): en 32 px platta i Discords färg — bara glyfen på
 * mobil (raden delar plats med nyhetsknappen och kontot; utloggat reserverar
 * kontot 128 px), etiketten "Discord" från sm. Den får aldrig konkurrera med loggan.
 *
 * Historik: 2026-09-11–10-05 visades den bara medan nyhetsflödet var DOLT
 * (`NewsLink` tog platsen bredvid kontot). 10-05 flyttad bredvid loggan, 10-06
 * till högergruppen bredvid nyhetsknappen; båda visas.
 */
export function DiscordLink() {
  const t = useTranslations("Common");
  return (
    <a
      href={DISCORD_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("discordLink")}
      title={t("discordLink")}
      className="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg bg-discord px-2 text-white transition-colors hover:bg-discord-hover sm:px-2.5"
    >
      <IconDiscord size={16} className="shrink-0" />
      <span className="hidden text-xs font-semibold sm:inline">Discord</span>
    </a>
  );
}
