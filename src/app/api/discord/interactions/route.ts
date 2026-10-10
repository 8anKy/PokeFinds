/**
 * POST /api/discord/interactions — Discords Interactions Endpoint (kommandot /pris).
 *
 * Logiken bor i src/lib/discord-price-command.ts (ren, testad); verifieringen i
 * src/lib/discord-interactions.ts. Den här filen limmar ihop dem med snapshoten.
 *
 * ⛔ RÖR ALDRIG DATABASEN. Allt svar kommer ur nattens katalogsnapshot på volymen —
 *    autocomplete fyrar ett anrop per tangenttryck, och en Neon-fråga per tryck hade
 *    köpt 300 s vaken tid varje gång (Kostnadsdoktrinen i CLAUDE.md).
 * ⛔ Discord kräver svar inom 3 s; snapshotläsningen är en fil (minnescachad).
 * ⛔ Osignerade anrop får 401 — Discord testar det när endpointen registreras.
 */
import { NextResponse } from "next/server";
import {
  discordPublicKey,
  InteractionType,
  memberHasPro,
  optionValue,
  ResponseType,
  verifyDiscordSignature,
  type DiscordInteraction,
} from "@/lib/discord-interactions";
import {
  autocompleteChoices,
  buildPriceEmbed,
  EPHEMERAL,
  PRICE_COMMAND_NAME,
  PRICE_COMMAND_OPTION,
  proRequiredMessage,
  resolveQuery,
  searchCatalogIndex,
} from "@/lib/discord-price-command";
import { readSnapshotEntry, readSnapshotIndex } from "@/lib/catalog-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ⛔ `||`, inte `??`: en tom sträng är felläget (se notifications.ts).
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se").replace(/\/$/, "");

function reply(data: Record<string, unknown>) {
  return NextResponse.json({ type: ResponseType.MESSAGE, data });
}

export async function POST(req: Request) {
  const body = await req.text();
  const key = await discordPublicKey();
  if (
    !key ||
    !verifyDiscordSignature(key, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"), body)
  ) {
    return new NextResponse("invalid request signature", { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(body) as DiscordInteraction;
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  if (interaction.type === InteractionType.PING) {
    return NextResponse.json({ type: ResponseType.PONG });
  }

  if (interaction.data?.name !== PRICE_COMMAND_NAME) {
    return reply({ content: "Okänt kommando.", flags: EPHEMERAL });
  }

  const isPro = memberHasPro(interaction, process.env.DISCORD_ROLE_PRO);

  if (interaction.type === InteractionType.AUTOCOMPLETE) {
    // Förslag även utan Pro: att se att produkten finns är reklam för kommandot,
    // svaret (priserna) är det som är Pro.
    const index = await readSnapshotIndex();
    const hits = index ? searchCatalogIndex(index, optionValue(interaction, PRICE_COMMAND_OPTION)) : [];
    return NextResponse.json({
      type: ResponseType.AUTOCOMPLETE_RESULT,
      data: { choices: autocompleteChoices(hits) },
    });
  }

  if (interaction.type !== InteractionType.APPLICATION_COMMAND) {
    return new NextResponse("unsupported", { status: 400 });
  }

  if (!interaction.member) {
    return reply({ content: "Använd /pris i Foilios Discord-server.", flags: EPHEMERAL });
  }
  if (!isPro) return reply(proRequiredMessage(APP_URL));

  const index = await readSnapshotIndex();
  if (!index) {
    return reply({ content: "Priserna laddas om just nu — prova igen om en stund.", flags: EPHEMERAL });
  }
  const query = optionValue(interaction, PRICE_COMMAND_OPTION);
  const hit = resolveQuery(index, query);
  if (!hit) {
    return reply({ content: `Hittade ingen produkt för "${query.slice(0, 80)}". Välj ett av förslagen medan du skriver.`, flags: EPHEMERAL });
  }
  const entry = await readSnapshotEntry(hit.s);
  if (!entry) {
    return reply({ content: `Inga priser för ${hit.t} i nattens data. Se ${APP_URL}/produkter/${hit.s}`, flags: EPHEMERAL });
  }
  return reply({ embeds: [buildPriceEmbed(entry, hit, APP_URL)], flags: EPHEMERAL });
}
