/**
 * Discord-integrationen: OAuth-länkning av konto + rollhantering i vår server.
 *
 * TVÅ SORTERS AUKTORISATION, blanda aldrig ihop dem:
 *  - ANVÄNDARENS OAuth-token (`Bearer`) — används EN gång, för att lägga till
 *    personen i servern (guilds.join). Sparas ALDRIG.
 *  - BOT-token (`Bot`) — allt annat: sätta och ta bort roller. Den lever i env.
 *
 * ⛔ Vi öppnar aldrig en Gateway-anslutning (websocket). Allt här är REST, och
 * därför behövs INGA privileged intents (Server Members m.fl.) — de är avstängda
 * i utvecklarportalen med flit.
 */
import { ServiceError } from "@/lib/errors";

const API = "https://discord.com/api/v10";
const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";

/**
 * Scopes vi begär av användaren. Medvetet minimalt (dataminimering):
 *  - `identify` ger id + användarnamn. INTE `email` — vi har redan en e-post.
 *  - `guilds.join` låter oss lägga till personen i servern.
 * ⛔ Lägg ALDRIG till `guilds`: den läser listan över VARJE server personen är
 * med i. Vi har ingen användning för den, och allt vi hämtar måste deklareras
 * i integritetspolicyn.
 */
export const DISCORD_SCOPES = "identify guilds.join";

/** Cookien som binder OAuth-`state` till webbläsaren som startade länkningen. */
export const DISCORD_STATE_COOKIE = "discord_oauth_state";

export interface DiscordBotConfig {
  botToken: string;
  guildId: string;
  roleVerified: string;
  rolePro: string;
}

export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Bot-delen: allt som krävs för att SÄTTA ROLLER. Eller `null` när integrationen
 * är avstängd/ofullständig.
 *
 * `DISCORD_ENABLED` är en egen spak vid sidan av hemligheterna — samma mönster
 * som `stripeEnabled()`. Poängen är att kunna stänga av integrationen utan att
 * rensa nycklarna, och att en halvkonfigurerad miljö ska bete sig som "avstängd"
 * i stället för att krascha på första klicket.
 *
 * ⛔ SKILD FRÅN OAuth-delen med flit. Nattjobbet gör aldrig ett OAuth-utbyte, så
 * det ska inte KRÄVA client secret för att köra — annars måste hemligheten ligga
 * i ytterligare ett förvar (GitHub Actions) utan att någonsin användas där.
 * Färre kopior av en hemlighet är färre ställen den kan läcka från, och ett
 * mindre ställe att glömma vid rotation.
 *
 * ⛔ Läser env vid ANROPET, inte på modulnivå: alla anropare är `force-dynamic`
 * eller jobb, och en modulnivå-läsning hade frusit värdet vid bygget (Railway
 * bygger utan runtime-env → allt hade sett avstängt ut i drift).
 */
export function discordBotConfig(): DiscordBotConfig | null {
  if (process.env.DISCORD_ENABLED !== "true") return null;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const roleVerified = process.env.DISCORD_ROLE_VERIFIED;
  const rolePro = process.env.DISCORD_ROLE_PRO;
  if (!botToken || !guildId || !roleVerified || !rolePro) return null;
  return { botToken, guildId, roleVerified, rolePro };
}

/** OAuth-delen: bara det som krävs för att LÄNKA ett konto. */
export function discordOAuthConfig(): DiscordOAuthConfig | null {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Kan vi hantera roller? (Nattjobbet och plan-synken frågar efter detta.) */
export function discordEnabled(): boolean {
  return discordBotConfig() !== null;
}

/** Kan en användare länka sitt konto? Kräver BÅDA halvorna. */
export function discordLinkingEnabled(): boolean {
  return discordEnabled() && discordOAuthConfig() !== null;
}

function requireBot(): DiscordBotConfig {
  const config = discordBotConfig();
  if (!config) throw new ServiceError(503, "Discord-koppling är inte tillgänglig just nu.");
  return config;
}

function requireOAuth(): DiscordOAuthConfig {
  const config = discordOAuthConfig();
  if (!config) throw new ServiceError(503, "Discord-koppling är inte tillgänglig just nu.");
  return config;
}

/** Vår callback-URL. Måste stå ORDAGRANT bland Redirects i utvecklarportalen. */
export function discordRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/discord/callback`;
}

/** Auktoriserings-URL:en användaren skickas till. `state` binds till en cookie. */
export function buildAuthorizeUrl(state: string): string {
  const config = requireOAuth();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: discordRedirectUri(),
    response_type: "code",
    scope: DISCORD_SCOPES,
    state,
    // Visa alltid samtyckesrutan. Utan detta hoppar Discord över den för den som
    // redan godkänt en gång, och en "länka konto"-knapp som tyst gör något är
    // sämre än en som frågar — särskilt när den flyttar identitet mellan tjänster.
    prompt: "consent",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Discord-anrop med 429-hantering.
 *
 * Discord svarar 429 med `retry_after` (SEKUNDER, decimaltal) och förväntar sig
 * att man väntar. Nattjobbet går igenom alla länkade konton i följd, så det ÄR
 * en realistisk träff — och en obehandlad 429 där hade sett ut som "rollen
 * kunde inte sättas" för en slumpmässig delmängd användare.
 */
async function discordFetch(
  path: string,
  init: RequestInit & { authorization: string },
  attempt = 0
): Promise<Response> {
  const { authorization, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      ...rest.headers,
      Authorization: authorization,
      "Content-Type": "application/json",
      "User-Agent": "Foilio (https://www.foilio.se, 1.0)",
    },
    cache: "no-store",
  });

  if (res.status === 429 && attempt < 3) {
    const body = (await res.json().catch(() => null)) as { retry_after?: number } | null;
    // Tak på 10 s: ett längre svar betyder att vi träffat en global gräns, och då
    // är rätt svar att avbryta och låta nästa körning ta det — inte att blockera.
    const waitMs = Math.min((body?.retry_after ?? 1) * 1000, 10_000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return discordFetch(path, init, attempt + 1);
  }
  return res;
}

/** Byter engångskoden mot en användartoken. Formulärkodat — Discord vägrar JSON här. */
export async function exchangeCode(code: string): Promise<string | null> {
  const config = requireOAuth();
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: discordRedirectUri(),
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    console.error(`[discord] token-utbyte misslyckades: ${res.status} ${await res.text()}`);
    return null;
  }
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

export interface DiscordIdentity {
  id: string;
  username: string;
}

/** Vem token tillhör. `id` är en snowflake — ALLTID sträng, aldrig ett tal. */
export async function fetchIdentity(accessToken: string): Promise<DiscordIdentity | null> {
  const res = await discordFetch("/users/@me", {
    method: "GET",
    authorization: `Bearer ${accessToken}`,
  });
  if (!res.ok) {
    console.error(`[discord] /users/@me misslyckades: ${res.status}`);
    return null;
  }
  const data = (await res.json()) as {
    id?: string;
    username?: string;
    global_name?: string | null;
  };
  if (!data.id) return null;
  return { id: data.id, username: data.global_name || data.username || data.id };
}

/**
 * Lägger till personen i servern.
 *
 * ⛔ Returnerar 204 (i stället för 201) när personen REDAN är medlem — och då
 * appliceras `roles` i kroppen INTE. Rollerna måste därför alltid sättas
 * separat med `addRole()` efteråt; att bara skicka dem här hade gett rätt
 * roller åt nya medlemmar och inga alls åt befintliga.
 */
export async function joinGuild(discordUserId: string, accessToken: string): Promise<boolean> {
  const config = requireBot();
  const res = await discordFetch(`/guilds/${config.guildId}/members/${discordUserId}`, {
    method: "PUT",
    authorization: `Bot ${config.botToken}`,
    body: JSON.stringify({ access_token: accessToken }),
  });
  // 201 = tillagd, 204 = redan medlem. Båda är framgång.
  if (res.status === 201 || res.status === 204) return true;
  console.error(`[discord] kunde inte lägga till ${discordUserId} i servern: ${res.status}`);
  return false;
}

/**
 * Sätter eller tar bort en roll. `reason` hamnar i serverns granskningslogg, så
 * ägaren kan se VARFÖR en roll ändrades utan att gräva i våra loggar.
 *
 * ⛔ 403 här betyder nästan alltid rollhierarkin: botens egen roll måste ligga
 * ÖVER rollen den sätter. Det felet är tyst för användaren, därav loggraden.
 */
async function setRole(
  discordUserId: string,
  roleId: string,
  add: boolean,
  reason: string
): Promise<boolean> {
  const config = requireBot();
  const res = await discordFetch(
    `/guilds/${config.guildId}/members/${discordUserId}/roles/${roleId}`,
    {
      method: add ? "PUT" : "DELETE",
      authorization: `Bot ${config.botToken}`,
      // ⛔ Korta FÖRST, koda sedan. Att klippa en redan kodad sträng kan kapa mitt
      // i en %-sekvens ("%C3%A5" → "%C3") och ge ett ogiltigt headervärde.
      // Kodningen är obligatorisk: headervärden får bara vara ASCII, och våra
      // skäl är svenska ("kontot länkades").
      headers: { "X-Audit-Log-Reason": encodeURIComponent(reason.slice(0, 100)) },
    }
  );
  if (res.status === 204) return true;
  // 404 vid borttagning = personen har lämnat servern. Inget fel: målet
  // ("rollen ska inte sitta kvar") är uppfyllt.
  if (!add && res.status === 404) return true;
  if (res.status === 403) {
    console.error(
      `[discord] 403 för roll ${roleId} — ligger botens roll ovanför den i serverns rollista?`
    );
    return false;
  }
  console.error(`[discord] rolländring misslyckades (${res.status}) för ${discordUserId}`);
  return false;
}

export function addRole(discordUserId: string, roleId: string, reason: string) {
  return setRole(discordUserId, roleId, true, reason);
}

export function removeRole(discordUserId: string, roleId: string, reason: string) {
  return setRole(discordUserId, roleId, false, reason);
}
