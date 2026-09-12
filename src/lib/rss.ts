/**
 * HTML-HJÄLPARE FÖR NYHETSFLÖDET (2026-09-09) — entiteter, taggstripp och
 * artikelsidans `og:image`.
 *
 * ⛔ RSS-LÄSAREN SOM BODDE HÄR ÄR BORTTAGEN 2026-09-12 (ägarbeslut): RSS-lanen
 *    publicerade sig själv förbi ägarens godkännande. Nyheter går via inkorgen.
 *    Filnamnet står kvar så importvägarna (feed-build, admin) inte behöver röras.
 *
 * ⛔ INGET NYTT BEROENDE. En HTML-parser hade dragit in ett paket för en uppgift
 *    som är en meta-tagg per sida. Läsaren är MEDVETET tolerant och kastar aldrig
 *    på skräp — en trasig sida får inte fälla hela jobbet.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

/** Avkodar de entiteter som faktiskt förekommer + numeriska. Två varv: `&amp;#39;`. */
export function decodeEntities(input: string): string {
  const once = (s: string) =>
    s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
      if (body[0] === "#") {
        const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[body.toLowerCase()] ?? whole;
    });
  return once(once(input));
}

/** Tar bort taggar och normaliserar blanksteg. Resultatet är ALLTID ren text. */
export function stripTags(input: string): string {
  return decodeEntities(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Artikelns egen delningsbild (`og:image`, annars `twitter:image`).
 *
 * VARFÖR: ett utkast ur inkorgen och en handskriven nyhet i `news.json` bär bara
 * en länk — och en rad utan omslag ser ut som ett fel bredvid raderna som har
 * ett. Byggjobbet hämtar därför artikelsidan EN gång per post och plockar ut den
 * bild sidan själv anger för delning.
 *
 * ⛔ Bilden HOTLÄNKAS, laddas aldrig ned. Det är samma bild sidan ber alla
 *    (Facebook, Slack, X) visa när länken delas — inte något vi grävt fram.
 * ⛔ Relativa `og:image` görs absoluta mot sidans egen URL; kan de inte göras
 *    absoluta kastas de. En halv URL är en trasig bild, och en trasig bild är
 *    sämre än ingen (då målas den tonade plattan i stället).
 */
export function extractOgImage(html: string, pageUrl: string): string | null {
  const head = html.slice(0, 200_000);
  const patterns = [
    /<meta[^>]+property\s*=\s*["']og:image(?::secure_url|:url)?["'][^>]*>/gi,
    /<meta[^>]+name\s*=\s*["']og:image["'][^>]*>/gi,
    /<meta[^>]+name\s*=\s*["']twitter:image(?::src)?["'][^>]*>/gi,
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(head))) {
      const content = m[0].match(/content\s*=\s*"([^"]*)"/i) ?? m[0].match(/content\s*=\s*'([^']*)'/i);
      const raw = content?.[1] ? decodeEntities(content[1]).trim() : "";
      if (!raw) continue;
      try {
        const url = new URL(raw, pageUrl);
        if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
      } catch {
        /* ogiltig URL — prova nästa träff */
      }
    }
  }
  return null;
}
