/**
 * Registrerar Foilios slash-kommandon i servern (just nu /pris) och, med
 * `--endpoint`, pekar applikationens Interactions Endpoint URL mot oss.
 *
 * Körs av `.github/workflows/discord-commands.yml` (manuell) — bot-token + guild-id
 * finns redan som GitHub-secrets. Ingen databas.
 *
 * ⛔ SERVERKOMMANDON (guild), inte globala: de syns direkt, globala tar upp till en
 *    timme och syns i varje server boten råkar vara med i.
 * ⛔ POST per kommando (skapar ELLER skriver över på namn) — aldrig PUT på listan, som
 *    hade raderat kommandon någon lagt till för hand.
 * ⛔ `--endpoint` först EFTER att /api/discord/interactions är deployad: Discord skickar
 *    en signerad PING till URL:en och vägrar spara den om svaret inte är rätt.
 *
 *   npx tsx scripts/register-discord-commands.ts [--endpoint]
 */
import { discordFetch } from "../src/lib/discord";
import { PRICE_COMMAND } from "../src/lib/discord-price-command";

const ENDPOINT_URL = `${(process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se").replace(/\/$/, "")}/api/discord/interactions`;

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!token || !guildId) throw new Error("DISCORD_BOT_TOKEN och DISCORD_GUILD_ID krävs.");
  const authorization = `Bot ${token}`;

  const appRes = await discordFetch("/oauth2/applications/@me", { method: "GET", authorization });
  if (!appRes.ok) throw new Error(`Kunde inte läsa applikationen: ${appRes.status} ${await appRes.text()}`);
  const app = (await appRes.json()) as { id: string; name?: string; interactions_endpoint_url?: string | null };
  console.log(`Applikation: ${app.name ?? "?"} (${app.id}). Nuvarande endpoint: ${app.interactions_endpoint_url ?? "–"}`);

  const res = await discordFetch(`/applications/${app.id}/guilds/${guildId}/commands`, {
    method: "POST",
    authorization,
    body: JSON.stringify(PRICE_COMMAND),
  });
  if (!res.ok) throw new Error(`Kunde inte registrera /${PRICE_COMMAND.name}: ${res.status} ${await res.text()}`);
  console.log(`✓ /${PRICE_COMMAND.name} registrerat i servern.`);

  if (process.argv.includes("--endpoint")) {
    const patch = await discordFetch("/applications/@me", {
      method: "PATCH",
      authorization,
      body: JSON.stringify({ interactions_endpoint_url: ENDPOINT_URL }),
    });
    if (!patch.ok) throw new Error(`Discord vägrade endpointen ${ENDPOINT_URL}: ${patch.status} ${await patch.text()}`);
    console.log(`✓ Interactions Endpoint URL = ${ENDPOINT_URL}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
