import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * TOM STRÄNG ÄR INTE "SAKNAS" — vakten mot hela buggklassen.
 *
 * GitHub Actions expanderar `${{ vars.X }}` / `${{ secrets.X }}` till TOM STRÄNG när
 * variabeln inte finns i repot. Ingen varning, ingen röd körning: steget får bara
 * `X=""` i miljön. Och `""` är varken `null` eller `undefined`, så `??` släpper
 * igenom den — reservvärdet används ALDRIG.
 *
 * Buggen slog till TVÅ gånger på ETT dygn (2026-08-16), i tre filer:
 *   · `mailer.ts`      — `EMAIL_FROM ?? "Foilio <noreply@foilio.se>"` → tom avsändare
 *                        → Resend `422 "The domain is invalid"`, hela veckobrevet dog.
 *                        Latent även i scrape-alls pro-expiry-steg, som bara mejlar när
 *                        någon håller på att förlora Pro — dvs det hade smällt först i
 *                        exakt det ögonblick meddelandet betyder något.
 *   · `templates.ts`
 *   · `weekly-digest.ts` — `NEXT_PUBLIC_APP_URL ?? "https://foilio.se"` → `href="/produkter"`
 *                        i ett SKARPT massutskick. Mejlklienten har ingen bas-URL att
 *                        lösa relativa länkar mot → `http:///produkter` och trasig logga.
 *
 * Samma familj som `variantLabel`-vakten 2026-07-28: en vakt som bara letar efter att
 * fältet SAKNAS ser inte ett fält som FINNS men är tomt.
 *
 * Därför är regeln generell och maskinell, inte en lista över dagens tre filer:
 * **varje env-variabel som ett workflow injicerar från `vars`/`secrets` måste läsas
 * med `||`, aldrig med `??`, när reservvärdet är sanningsvärt.**
 * (`?? ""` / `?? undefined` / `?? 0` är ofarligt — då beter sig `??` och `||` lika.)
 */

const ROOT = resolve(__dirname, "../..");
const WORKFLOW_DIR = join(ROOT, ".github/workflows");
const SRC_DIR = join(ROOT, "src");

// ---------------------------------------------------------------------------
// 1. Den generella regeln: workflow-injicerade variabler läses med ||
// ---------------------------------------------------------------------------

/**
 * Alla env-namn som något workflow sätter från `${{ vars.X }}` eller `${{ secrets.X }}`.
 * Det är EXAKT den mängd där en frånvarande repo-variabel blir en tom sträng — en
 * variabel vi bara sätter lokalt eller i Railway har inte den semantiken.
 *
 * Läses som TEXT: js-yaml är inget deklarerat beroende, och en vakt ska inte införa ett
 * (samma val som `cron-chain-sync.test.ts`).
 */
function injectedEnvNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(WORKFLOW_DIR)) {
    if (!/\.ya?ml$/.test(file)) continue;
    const yaml = readFileSync(join(WORKFLOW_DIR, file), "utf8");
    for (const m of yaml.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*\$\{\{\s*(?:vars|secrets)\./gm)) {
      names.add(m[1]);
    }
  }
  return names;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Är reservvärdet SANNINGSVÄRT? Bara då spelar `??` vs `||` roll.
 * `x ?? ""` och `x || ""` ger båda `""` för en tom variabel — inget hål.
 * `x ?? "https://foilio.se"` ger `""`. Det är hålet.
 */
function fallbackIsTruthy(raw: string): boolean {
  const s = raw.trim();
  const quoted = s.match(/^(["'`])(.*?)\1/s);
  if (quoted) return quoted[2].length > 0;
  const numeric = s.match(/^(-?[\d_.]+)/);
  if (numeric) return Number(numeric[1].replace(/_/g, "")) !== 0;
  // Uttryck (annan process.env, funktionsanrop, variabel) — kan inte avgöras
  // statiskt. Vakten anmäler bara det den kan bevisa.
  return false;
}

interface Occurrence {
  key: string; // "src/lib/x.ts:VAR" — stabil över radnummer, så vakten inte gnisslar vid varje edit
  detail: string;
}

function findNullishReads(injected: Set<string>): Occurrence[] {
  const found: Occurrence[] = [];
  for (const file of sourceFiles(SRC_DIR)) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        for (const m of line.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)\s*\?\?\s*([^;,)\n]*)/g)) {
          const [, name, fallback] = m;
          if (!injected.has(name)) continue;
          if (!fallbackIsTruthy(fallback)) continue;
          found.push({
            key: `${rel}:${name}`,
            detail: `${rel}:${i + 1} — process.env.${name} ?? ${fallback.trim()}`,
          });
        }
      });
  }
  return found;
}

/**
 * KÄNDA HÅL som fanns FÖRE vakten (2026-08-16). Alla är samma bugg, bara ännu inte
 * utlöst — de ligger här för att vakten ska kunna sättas i drift i dag i stället för
 * att vänta på en städrunda som aldrig blir av.
 *
 * ⛔ LISTAN FÅR BARA KRYMPA. Ett nytt `??` på en workflow-injicerad variabel failar,
 * och en post som städats bort failar också (annars ruttnar listan och skyddar en fil
 * som för längesedan är rätt). Städa en rad → ta bort raden här.
 *
 * ⚠️ HETAST FÖRST — dessa körs faktiskt i GitHub Actions med variabeln injicerad:
 *   · `src/jobs/*.ts:CARDMARKET_RAPIDAPI_HOST` — tom host ⇒ `https:///…` ⇒ hela
 *     CM-uppdateringen faller, tyst.
 * Resten läses i webrequests (Railway-miljö) där tomma värden är mindre sannolika,
 * men inte omöjliga.
 */
const KNOWN_GAPS: readonly string[] = [
  // Städat 2026-08-17: `src/services/notifications.ts:NEXT_PUBLIC_APP_URL` läser nu med
  // `||`. Den var listans hetaste post — den bygger djuplänkarna i restock- och
  // prisfallslarmen från scrape-all, alltså exakt samma tomma-bas-URL som sänkte
  // veckobrevet 2026-08-16, fast i mejl som redan lämnat huset.
  "src/jobs/cardmarket-refresh.ts:CARDMARKET_RAPIDAPI_HOST",
  "src/jobs/hot-card-refresh.ts:CARDMARKET_RAPIDAPI_HOST",
  "src/jobs/sealed-set-label.ts:CARDMARKET_RAPIDAPI_HOST",
  // Städat 2026-08-17 (SEO-passet): robots.ts, sitemap.ts, [locale]/layout.tsx och
  // lib/canonical.ts läser nu med `||` mot "https://foilio.se". Alla fyra byggde
  // ABSOLUTA URL:er som Google läser — en tom variabel gav `http://localhost:3000` i
  // canonical/sitemap (tyst självavindexering) och ett kastande `new URL("")` i
  // rot-layouten. Raderna är borta här med flit: listan får bara krympa.
  "src/app/[locale]/(app)/admin/kreatorer/page.tsx:NEXT_PUBLIC_APP_URL",
  "src/app/api/auth/forgot/route.ts:NEXT_PUBLIC_APP_URL",
  "src/app/api/auth/resend-verification/route.ts:NEXT_PUBLIC_APP_URL",
  "src/app/api/discord/callback/route.ts:NEXT_PUBLIC_APP_URL",
  "src/app/api/discord/connect/route.ts:NEXT_PUBLIC_APP_URL",
  "src/app/api/tradera/callback/route.ts:NEXT_PUBLIC_APP_URL",
  "src/app/api/tradera/connect/route.ts:NEXT_PUBLIC_APP_URL",
  "src/app/api/unsubscribe/route.ts:NEXT_PUBLIC_APP_URL",
  "src/lib/discord.ts:NEXT_PUBLIC_APP_URL",
];

describe("workflow-injicerade env-variabler läses med || (tom sträng ≠ saknas)", () => {
  const injected = injectedEnvNames();

  it("hittar över huvud taget de injicerade variablerna i .github/workflows", () => {
    // Går den här sönder är resten av sviten en tom bekräftelse — då har YAML-formatet
    // ändrats och vakten mäter ingenting alls.
    expect(injected.size).toBeGreaterThan(10);
    expect(injected).toContain("EMAIL_FROM");
    expect(injected).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("ingen NY läsning med ?? och sanningsvärt reservvärde", () => {
    const nya = findNullishReads(injected)
      .filter((o) => !KNOWN_GAPS.includes(o.key))
      .map((o) => o.detail)
      .sort();
    expect(
      nya,
      "En workflow-injicerad variabel läses med `??`. GitHub Actions ger den TOM STRÄNG " +
        "när repo-variabeln saknas, och `\"\" ?? default` är `\"\"` — reservvärdet används " +
        "aldrig. Byt till `||`."
    ).toEqual([]);
  });

  it("listan över kända hål har inte ruttnat (städat ska stanna städat)", () => {
    const kvar = new Set(findNullishReads(injected).map((o) => o.key));
    const stale = KNOWN_GAPS.filter((k) => !kvar.has(k));
    expect(
      stale,
      "Posterna är städade i koden men står kvar i KNOWN_GAPS. Ta bort dem — annars " +
        "skyddar listan filer som för längesedan är rätt, och nästa `??` där glider in."
    ).toEqual([]);
  });

  // De tre filerna incidenten faktiskt gällde. De får ALDRIG in i KNOWN_GAPS igen.
  it.each([
    ["src/lib/mailer.ts", "EMAIL_FROM"],
    ["src/lib/mailer.ts", "EMAIL_REPLY_TO"],
    ["src/emails/templates.ts", "NEXT_PUBLIC_APP_URL"],
    ["src/jobs/weekly-digest.ts", "NEXT_PUBLIC_APP_URL"],
  ])("%s läser inte %s med ??", (file, name) => {
    const txt = readFileSync(join(ROOT, file), "utf8");
    expect(txt).not.toMatch(new RegExp(`process\\.env\\.${name}\\s*\\?\\?`));
  });
});

// ---------------------------------------------------------------------------
// 2. Veckobrevet: inga relativa URL:er, någonsin
// ---------------------------------------------------------------------------

async function loadTemplates() {
  return import("@/emails/templates");
}
type WeeklyDigestArg = Parameters<Awaited<ReturnType<typeof loadTemplates>>["weeklyDigestEmail"]>[0];

const APP_URL = "https://digest-vakt.example";

/**
 * Byggd mot KONTRAKTET (`appUrl` injiceras av jobbet, bilder och set-progress är nya
 * fält), inte mot dagens rader. Casten finns just därför: vakten ska tåla att
 * signaturen får fler fält utan att testet måste skrivas om.
 */
function digestData(): WeeklyDigestArg {
  return {
    name: "Milos",
    unsubscribeUrl: "https://foilio.se/avregistrera?token=abc123",
    appUrl: APP_URL,
    collection: {
      totalValueOre: 1_234_500,
      changeOre: 42_300,
      changePercent: 3.5,
      movers: [
        {
          name: "Charizard ex",
          setName: "Obsidian Flames",
          percent: 12.4,
          valueOre: 89_900,
          imageUrl: "https://images.example/charizard.png",
          url: `${APP_URL}/produkter/charizard-ex`,
        },
      ],
    },
    drops: [
      {
        title: "Prismatic Evolutions ETB",
        url: `${APP_URL}/produkter/prismatic-evolutions-etb`,
        priceOre: 64_900,
        percent: -8.2,
        imageUrl: "https://images.example/pe-etb.png",
      },
    ],
    restocks: [
      {
        title: "151 Booster Bundle",
        url: "https://demobutiken.se/produkt/151-booster-bundle",
        retailerName: "Demobutiken",
        priceOre: 39_900,
        imageUrl: "https://images.example/151-bundle.png",
      },
    ],
    setProgress: [
      { setName: "Surging Sparks", owned: 42, total: 191, url: `${APP_URL}/sets/sv08` },
    ],
    pulse: {
      underMarketCount: 17,
      minDiscountPercent: 15,
      examples: [
        {
          title: "Paldean Fates ETB",
          url: "https://demobutiken.se/produkt/paldean-fates-etb",
          retailerName: "Demobutiken",
          priceOre: 49_900,
          percentUnder: 22,
        },
      ],
      restockCount: 58,
      newSetCount: 1,
    },
  } as unknown as WeeklyDigestArg;
}

/** Varje `href="…"` och `src="…"` i HTML:en. */
function extractUrls(html: string): string[] {
  return [...html.matchAll(/\b(?:href|src)\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
}

describe("weeklyDigestEmail: absoluta URL:er i ett skarpt massutskick", () => {
  /**
   * Reproducerar exakt vad ägaren såg: workflowet satte `NEXT_PUBLIC_APP_URL=""`
   * (repo-variabeln fanns inte), mallens `??`-reserv hoppades över, och varje länk
   * blev relativ. Ett mejl har ingen bas-URL att lösa dem mot — Gmail visade
   * `http:///produkter` och loggan blev en trasig bildruta.
   *
   * Med kontraktet (URL:en kommer in som `appUrl`) kan miljön vara hur trasig som
   * helst utan att brevet blir det. Därför körs testet med den TOMMA variabeln satt:
   * passerar det då, kan mallen inte längre gå på den här minan.
   */
  async function renderWith(envValue: string) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", envValue);
    const { weeklyDigestEmail } = await loadTemplates();
    const out = weeklyDigestEmail(digestData());
    vi.unstubAllEnvs();
    return out;
  }

  it.each([
    ["tom sträng (GitHub Actions utan repo-variabel)", ""],
    ["felaktig miljö (pekar på localhost)", "http://localhost:3000"],
  ])("ingen relativ href/src när miljön är %s", async (_label, envValue) => {
    const email = await renderWith(envValue);
    const urls = extractUrls(email.html);

    // En mall utan länkar hade passerat tomt — då mäter vakten ingenting.
    expect(urls.length).toBeGreaterThan(3);

    const relativa = urls.filter((u) => !/^(https:\/\/|mailto:)/.test(u));
    expect(
      relativa,
      "Relativ URL i veckobrevet. En mejlklient har ingen bas-URL — länken blir " +
        "`http:///…` och bilden en trasig ruta. Bygg URL:en av `appUrl`, aldrig av en " +
        "modulkonstant som läser process.env."
    ).toEqual([]);
  });

  it("URL:erna byggs av appUrl, inte av miljön", async () => {
    // Utan det här testet skulle mallen kunna fortsätta läsa process.env och ändå
    // passera ovan, så länge miljön råkar vara satt i testkörningen.
    const email = await renderWith("");
    expect(email.html).toContain(APP_URL);
    expect(email.text).toContain(APP_URL);
    expect(email.html).not.toContain("localhost");
  });

  it("textversionen bär inga trasiga eller relativa länkar", async () => {
    const email = await renderWith("");
    expect(email.text).not.toContain("http:///");
    expect(email.text).not.toContain("undefined/");
    // Avanmälan MÅSTE finnas i textversionen — utan den är spamknappen enda utvägen.
    expect(email.text).toContain("https://foilio.se/avregistrera?token=abc123");
  });

  it("avanmälningslänken är absolut även den", async () => {
    const email = await renderWith("");
    expect(email.html).toContain('href="https://foilio.se/avregistrera?token=abc123"');
  });
});

// ---------------------------------------------------------------------------
// 3. Mallen får inte läsa miljön alls
// ---------------------------------------------------------------------------

describe("src/emails/templates.ts läser ingen miljövariabel", () => {
  /**
   * Rotorsaken var inte `??` i sig — det var att MALLEN själv skulle veta vilken sajt
   * den tillhör. Ett mejl renderas i ett jobb, i en webrequest och i en testkörning,
   * och bara ANROPAREN vet vilken bas-URL som gäller. Kommer URL:en in som parameter
   * finns hålet inte att laga: det finns inte.
   *
   * ⛔ Vakten är avsiktligt total (INGEN `process.env` alls, inte bara app-URL:en) —
   * annars kryper nästa variabel in i mallen och vi gör om resan.
   */
  it("innehåller ingen process.env-läsning", () => {
    const txt = readFileSync(join(ROOT, "src/emails/templates.ts"), "utf8");
    const träffar = [...txt.matchAll(/process\.env\.?[A-Za-z0-9_[\]"']*/g)].map((m) => m[0]);
    expect(
      träffar,
      "E-postmallen läser miljön. URL:er och avsändare ska komma in som parametrar — " +
        "anroparen är den enda som vet vilken sajt mejlet gäller."
    ).toEqual([]);
  });

  it("veckobrevsjobbet skickar in appUrl i stället", () => {
    // Kontraktet: jobbet löser bas-URL:en (med ||-reserv, vaktad ovan) och injicerar
    // den. Utan den här raden kunde mallen vara ren och jobbet ändå skicka en tom bas.
    const job = readFileSync(join(ROOT, "src/jobs/weekly-digest.ts"), "utf8");
    expect(job).toMatch(/appUrl/);
  });
});
