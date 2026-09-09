/**
 * MINIMAL RSS/ATOM-LÄSARE (2026-09-09) — bara det nyhetsflödet behöver.
 *
 * ⛔ INGET NYTT BEROENDE. En XML-parser hade dragit in ett paket i appens bundle
 *    för en uppgift som är fem fält per post, och flödesfilerna vi läser är
 *    maskingenererade (WordPress, Reddit/Atom) — inte godtycklig XML. Den här
 *    läsaren är MEDVETET tolerant: ett fält den inte hittar blir `null`, och en
 *    post utan rubrik eller länk kastas. Den ska aldrig kasta undantag på skräp,
 *    för ett trasigt flöde får inte fälla hela jobbet.
 *
 * ⛔ Den är INTE en generell XML-parser och ska inte bli det. Behöver vi mer
 *    (namespaces, nästlade entiteter) är svaret ett riktigt bibliotek i JOBBET,
 *    inte mer regex här.
 */

export interface RssEntry {
  title: string;
  link: string;
  publishedAt: string | null;
  summary: string;
  imageUrl: string | null;
}

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

function unwrap(raw: string): string {
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return (cdata ? cdata[1] : raw).trim();
}

/** Innehållet i första `<tag>…</tag>`, oavsett namespace-prefix. */
function tagText(xml: string, ...names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${name}>`, "i");
    const m = xml.match(re);
    if (m) {
      const value = unwrap(m[1]);
      if (value) return value;
    }
  }
  return null;
}

/** Ett attribut ur första taggen som matchar. */
function tagAttr(xml: string, name: string, attr: string, requireAttr?: RegExp): string | null {
  const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${name}\\b([^>]*)>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    if (requireAttr && !requireAttr.test(attrs)) continue;
    const v = attrs.match(new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, "i")) ?? attrs.match(new RegExp(`\\b${attr}\\s*=\\s*'([^']*)'`, "i"));
    if (v?.[1]) return decodeEntities(v[1]).trim();
  }
  return null;
}

function firstImage(...html: (string | null)[]): string | null {
  for (const chunk of html) {
    if (!chunk) continue;
    const m = chunk.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
    if (m?.[1]) {
      const url = decodeEntities(m[1]).trim();
      if (/^https?:\/\//i.test(url)) return url;
    }
  }
  return null;
}

function absoluteUrl(value: string | null): string | null {
  if (!value) return null;
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * Delar upp ett flöde i poster. RSS `<item>`, Atom `<entry>`. Returnerar råa
 * XML-block; splitten är avsiktligt dum (ingen nästling förekommer i flöden).
 */
function splitEntries(xml: string): string[] {
  const out: string[] = [];
  for (const tag of ["item", "entry"]) {
    const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) out.push(m[1]);
    if (out.length) break;
  }
  return out;
}

/** Flödets egen titel (`<channel><title>` / Atoms rot-`<title>`). */
export function parseFeedTitle(xml: string): string | null {
  const head = xml.split(/<(?:[a-zA-Z0-9]+:)?(?:item|entry)\b/i)[0];
  const title = tagText(head, "title");
  return title ? stripTags(title) : null;
}

export function parseFeed(xml: string, limit = 30): RssEntry[] {
  const entries: RssEntry[] = [];
  for (const raw of splitEntries(xml)) {
    const title = tagText(raw, "title");
    // RSS: <link>url</link>. Atom: <link href="..."/> — ta alternate/utan rel,
    // aldrig rel="replies"/"enclosure" (Reddit skickar flera).
    const link =
      absoluteUrl(tagText(raw, "link")) ??
      absoluteUrl(tagAttr(raw, "link", "href", /rel\s*=\s*["']alternate["']/i)) ??
      absoluteUrl(tagAttr(raw, "link", "href"));
    if (!title || !link) continue;

    const contentHtml = tagText(raw, "encoded", "content", "description", "summary");
    const image =
      absoluteUrl(tagAttr(raw, "content", "url", /medium\s*=\s*["']image["']/i)) ??
      absoluteUrl(tagAttr(raw, "thumbnail", "url")) ??
      absoluteUrl(tagAttr(raw, "enclosure", "url", /type\s*=\s*["']image\//i)) ??
      firstImage(contentHtml);

    const dateRaw = tagText(raw, "pubDate", "published", "updated", "date");
    const parsed = dateRaw ? Date.parse(dateRaw) : NaN;

    entries.push({
      title: stripTags(title),
      link,
      publishedAt: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
      summary: contentHtml ? stripTags(contentHtml) : "",
      imageUrl: image,
    });
    if (entries.length >= limit) break;
  }
  return entries;
}
