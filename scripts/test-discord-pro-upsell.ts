/**
 * PROV AV "SKAFFA PRO"-KNAPPEN — som DM till EN person (2026-11-23).
 *
 * Skickar två exempel byggda med lanens egen kod (`buildRestockEmbed`):
 *  1. den fördröjda kopian av ett butikslarm (Pro-raden + knappen),
 *  2. ett vanligt onlineinlägg med bara knappen.
 * Inget postas i någon kanal, inget state rörs, ingen databas.
 *
 *   railway run npx tsx scripts/test-discord-pro-upsell.ts --discord-id <id>           (rapport)
 *   railway run npx tsx scripts/test-discord-pro-upsell.ts --discord-id <id> --apply   (skickar)
 *   … --pro-channel <id>   (kanalen som nämns i Pro-raden)
 */
import { buildRestockEmbed, type RestockPost } from "../src/lib/discord-restock";
import { proUpsellComponents, withProHeadStart } from "../src/lib/discord-pro-upsell";

const APPLY = process.argv.includes("--apply");
const SITE = "https://scoutr.se";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const base = {
  imageUrl: null,
  series: "Mega Evolution",
  setName: "30th Celebration",
  language: "EN",
  productUrl: `${SITE}/produkter/pokemon-tcg-30th-celebration-booster-bundle`,
} satisfies Partial<RestockPost>;

const storePost: RestockPost = {
  ...base,
  key: "test\tstore",
  title: "Pokémon TCG: 30th Celebration Booster Bundle",
  storeName: "SF-Bok",
  storeUrl: "https://www.sfbok.se/",
  priceOre: 39900,
  marketValueOre: 52000,
  storeOnly: true,
  storeStock: {
    units: 9,
    stores: 1,
    capped: false,
    locations: [{ id: "S030", label: "Göteborg", units: 9, capped: false, city: "Göteborg" }],
  },
};

const onlinePost: RestockPost = {
  ...base,
  key: "test\tonline",
  title: "Pokémon TCG: 30th Celebration Booster Bundle",
  storeName: "Speltrollet",
  storeUrl: "https://www.speltrollet.se/",
  priceOre: 44900,
  marketValueOre: 52000,
};

async function main() {
  const id = arg("discord-id");
  const proChannel = arg("pro-channel") ?? null;
  const messages = [
    {
      content: "**TEST 1 av 2** — butikslarmet som gratismedlemmar ser 15 min efter Pro.",
      embeds: [withProHeadStart(buildRestockEmbed(storePost), proChannel)],
      components: proUpsellComponents(SITE),
    },
    {
      content: "**TEST 2 av 2** — ett vanligt onlineinlägg med knappen (ingen fördröjning).",
      embeds: [buildRestockEmbed(onlinePost)],
      components: proUpsellComponents(SITE),
    },
  ];
  if (!APPLY) {
    console.log(JSON.stringify(messages, null, 2));
    console.log("Torrkörning — lägg till --apply för att skicka.");
    return;
  }
  if (!id) throw new Error("Ange --discord-id <id>.");
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN saknas (kör via `railway run`).");
  const headers = { authorization: `Bot ${token}`, "content-type": "application/json" };
  const ch = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers,
    body: JSON.stringify({ recipient_id: id }),
  });
  if (!ch.ok) throw new Error(`Kunde inte öppna DM-kanal: ${ch.status} ${await ch.text()}`);
  const dm = (await ch.json()) as { id: string };
  for (const m of messages) {
    const res = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(m),
    });
    if (!res.ok) throw new Error(`DM nekades: ${res.status} ${await res.text()}`);
  }
  console.log("Två test-DM skickade.");
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
