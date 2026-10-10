/**
 * DISCORD-INTERAKTIONER ÖVER HTTP (2026-10-10, kommandot /pris).
 *
 * Discord POST:ar varje slash-kommando till vår Interactions Endpoint URL och KRÄVER
 * att vi verifierar Ed25519-signaturen — en endpoint som svarar på osignerade anrop
 * avregistreras av Discord vid valideringen. Vi öppnar ingen Gateway (se lib/discord.ts).
 *
 * ⛔ PUBLIK NYCKEL UTAN NY VARIABEL: `DISCORD_PUBLIC_KEY` om den är satt, annars hämtas
 *    applikationens `verify_key` EN gång per process med bot-token
 *    (GET /oauth2/applications/@me). Nyckeln är publik; bot-token finns redan i Railway.
 */
import { createPublicKey, verify } from "node:crypto";
import { discordFetch } from "@/lib/discord";

/** DER-prefix för en rå 32-byte Ed25519-nyckel (SubjectPublicKeyInfo). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Är anropet signerat av Discord? Kastar aldrig — trasig hex, fel längd eller fel
 * nyckel ger `false`.
 */
export function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string | null,
  timestamp: string | null,
  body: string
): boolean {
  if (!signatureHex || !timestamp) return false;
  try {
    const raw = Buffer.from(publicKeyHex, "hex");
    const sig = Buffer.from(signatureHex, "hex");
    if (raw.length !== 32 || sig.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
    return verify(null, Buffer.from(timestamp + body, "utf8"), key, sig);
  } catch {
    return false;
  }
}

let cachedKey: string | null = null;

/** Applikationens publika nyckel (hex), eller null när den inte går att få fram. */
export async function discordPublicKey(): Promise<string | null> {
  const fromEnv = process.env.DISCORD_PUBLIC_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (cachedKey) return cachedKey;
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return null;
  try {
    const res = await discordFetch("/oauth2/applications/@me", { method: "GET", authorization: `Bot ${token}` });
    if (!res.ok) return null;
    const app = (await res.json()) as { verify_key?: string };
    cachedKey = app.verify_key ?? null;
    return cachedKey;
  } catch {
    return null;
  }
}

/** Interaktionstyper vi hanterar (Discord API v10). */
export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, AUTOCOMPLETE: 4 } as const;
/** Svarstyper. */
export const ResponseType = { PONG: 1, MESSAGE: 4, AUTOCOMPLETE_RESULT: 8 } as const;

export interface DiscordInteraction {
  type: number;
  data?: {
    name?: string;
    options?: { name: string; value?: string | number; focused?: boolean }[];
  };
  /** Satt i en server — bär medlemmens roller. Saknas i DM. */
  member?: { roles?: string[] };
}

/** Värdet på ett namngivet alternativ (eller det fokuserade vid autocomplete). */
export function optionValue(i: DiscordInteraction, name: string): string {
  const opt = i.data?.options?.find((o) => o.name === name);
  return opt?.value == null ? "" : String(opt.value);
}

/** Har medlemmen Pro-rollen? Ingen roll konfigurerad ⇒ nej (fail closed). */
export function memberHasPro(i: DiscordInteraction, proRoleId: string | undefined | null): boolean {
  if (!proRoleId) return false;
  return (i.member?.roles ?? []).includes(proRoleId);
}
