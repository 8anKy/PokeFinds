/**
 * LARM SOM DISCORD-DM (Pro, ägarbeslut 2026-10-10).
 *
 * Bevakningslarmen (restock + prislarm) går som ett privat meddelande från boten till
 * den som länkat sitt Discord-konto, slagit på `notificationSettings.discord` och har
 * Pro. Det är en KANAL bredvid mejl och push, inte ett nytt larm: samma Alert-rad,
 * samma rubrik, text och länk som pushen (`buildAlertNotice` i services/notifications.ts).
 *
 * ⛔ BÄSTA FÖRSÖK, KASTAR ALDRIG. DM:et skickas EFTER mejl och push i samma varv; ett
 *    kast härifrån hade gjort larmet PENDING igen och mejlet hade gått ut en gång till
 *    vid nästa försök. Stängda DM (Discord 50007: personen har stängt DM från
 *    servermedlemmar eller lämnat servern) är ett normalt utfall, inte ett fel.
 * ⛔ EGEN SPAK-LÄSNING, INTE `discordBotConfig()`: den kräver guild- och roll-id:n som
 *    prisjobben i Actions inte har och inte behöver. Ett DM kräver bara bot-token.
 * ⛔ Inga nya personuppgifter: `User.discordUserId` finns redan sedan länkningen.
 */
import { discordFetch } from "@/lib/discord";

/** Turkos signaturaccent (`holo.cyan`). */
const BRAND_COLOR = 0x2dd4bf;
const MAX_TITLE = 256;
const MAX_DESCRIPTION = 4096;

/** Bot-token när DM kan skickas, annars null (integrationen av/ofullständig). */
export function discordDmToken(): string | null {
  if (process.env.DISCORD_ENABLED !== "true") return null;
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  return token ? token : null;
}

export interface AlertDmContent {
  title: string;
  body: string;
  /** Absolut länk (butik/korg/produktsida), eller null. */
  url: string | null;
  imageUrl?: string | null;
}

function clamp(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Ren funktion så formatet går att testa utan nätverk. */
export function buildAlertDmEmbed(c: AlertDmContent) {
  return {
    title: clamp(c.title, MAX_TITLE),
    description: clamp(c.body, MAX_DESCRIPTION),
    ...(c.url ? { url: c.url } : {}),
    color: BRAND_COLOR,
    ...(c.imageUrl ? { thumbnail: { url: c.imageUrl } } : {}),
    footer: { text: "Foilio Pro · stäng av under Inställningar → Notiser" },
    timestamp: new Date().toISOString(),
  };
}

/**
 * DM-kanalen per Discord-användare, per process. Att öppna en DM-kanal är ett eget
 * anrop; samma person får ofta flera larm i samma utskick (ett släpp).
 */
const dmChannels = new Map<string, string>();

export type DmResult = "sent" | "closed" | "failed" | "off";

export async function sendAlertDm(discordUserId: string, content: AlertDmContent): Promise<DmResult> {
  const token = discordDmToken();
  if (!token) return "off";
  const authorization = `Bot ${token}`;
  try {
    let channelId = dmChannels.get(discordUserId);
    if (!channelId) {
      const res = await discordFetch("/users/@me/channels", {
        method: "POST",
        authorization,
        body: JSON.stringify({ recipient_id: discordUserId }),
      });
      if (!res.ok) {
        console.warn(`[discord-dm] Kunde inte öppna DM-kanal: ${res.status} ${await res.text().catch(() => "")}`);
        return res.status === 403 || res.status === 400 ? "closed" : "failed";
      }
      const data = (await res.json()) as { id?: string };
      if (!data.id) return "failed";
      channelId = data.id;
      dmChannels.set(discordUserId, channelId);
    }
    const res = await discordFetch(`/channels/${channelId}/messages`, {
      method: "POST",
      authorization,
      body: JSON.stringify({ embeds: [buildAlertDmEmbed(content)] }),
    });
    if (res.ok) return "sent";
    // 403 (kod 50007) = DM stängda för boten — personens eget val, inget att försöka om.
    if (res.status === 403) return "closed";
    console.warn(`[discord-dm] DM nekades: ${res.status} ${await res.text().catch(() => "")}`);
    return "failed";
  } catch (e) {
    console.warn("[discord-dm] Oväntat fel:", e instanceof Error ? e.message : e);
    return "failed";
  }
}
