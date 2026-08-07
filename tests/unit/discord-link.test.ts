/**
 * Discord-kopplingen: konfigurationsgrindar, scope-omfång och rollsynkens
 * indataform.
 *
 * De tre sakerna som testas här är precis de som failar TYST i drift:
 *  1. Kill-switchen — en halvkonfigurerad miljö ska bete sig som "avstängd",
 *     inte krascha på första klicket.
 *  2. Scope-omfånget — begär vi `email` eller `guilds` hämtar vi personuppgifter
 *     som integritetspolicyn inte deklarerar, och ingen skulle märka det.
 *  3. `DISCORD_SYNC_SELECT` — saknas ett av `isPro()`s fyra fält blir det
 *     `undefined` och vakten failar ÖPPET (samma familj som `variantLabel`
 *     2026-07-28 och `stripeProUntil` i users/me).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn() } },
  withDbRetry: (fn: () => unknown) => fn(),
}));

import {
  buildAuthorizeUrl,
  discordBotConfig,
  discordEnabled,
  discordLinkingEnabled,
  discordOAuthConfig,
  discordRedirectUri,
  DISCORD_SCOPES,
} from "@/lib/discord";
import { DISCORD_SYNC_SELECT, syncDiscordRoles, revokeDiscordRoles } from "@/services/discord-sync";

const FULL_ENV = {
  DISCORD_ENABLED: "true",
  DISCORD_CLIENT_ID: "1535392704916103168",
  DISCORD_CLIENT_SECRET: "hemlis",
  DISCORD_BOT_TOKEN: "bot-token",
  DISCORD_GUILD_ID: "1522299359910166650",
  DISCORD_ROLE_VERIFIED: "1535392299037491260",
  DISCORD_ROLE_PRO: "1534614609363730703",
  NEXT_PUBLIC_APP_URL: "https://www.foilio.se",
};

const saved = { ...process.env };

beforeEach(() => {
  for (const [k, v] of Object.entries(FULL_ENV)) process.env[k] = v;
});

afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("konfigurationsgrindar", () => {
  it("full konfiguration → både bot och länkning är på", () => {
    expect(discordBotConfig()).not.toBeNull();
    expect(discordOAuthConfig()).not.toBeNull();
    expect(discordEnabled()).toBe(true);
    expect(discordLinkingEnabled()).toBe(true);
  });

  it("DISCORD_ENABLED=false stänger av ALLT trots att hemligheterna finns", () => {
    // Kill-switchen är hela poängen: koden ska kunna ligga i produktion helt
    // vilande tills ägaren flippar spaken i Railway.
    process.env.DISCORD_ENABLED = "false";
    expect(discordBotConfig()).toBeNull();
    expect(discordEnabled()).toBe(false);
    expect(discordLinkingEnabled()).toBe(false);
  });

  it("saknad spak (odefinierad env) räknas som avstängd, inte som påslagen", () => {
    delete process.env.DISCORD_ENABLED;
    expect(discordEnabled()).toBe(false);
  });

  it.each(["DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "DISCORD_ROLE_VERIFIED", "DISCORD_ROLE_PRO"])(
    "saknad %s → avstängd i stället för halvfungerande",
    (key) => {
      delete process.env[key];
      expect(discordBotConfig()).toBeNull();
      expect(discordEnabled()).toBe(false);
    }
  );

  it("nattjobbet klarar sig UTAN client secret — den ska inte behöva ligga i GitHub Actions", () => {
    // Rollavstämningen gör aldrig ett OAuth-utbyte. Kräver botkonfigurationen
    // klienthemligheten glider den in i ännu ett hemlighetsförvar utan att
    // användas där — ett extra ställe att läcka från och att glömma vid rotation.
    delete process.env.DISCORD_CLIENT_ID;
    delete process.env.DISCORD_CLIENT_SECRET;
    expect(discordBotConfig()).not.toBeNull();
    expect(discordEnabled()).toBe(true);
    // ...men själva LÄNKNINGEN måste vara av, annars visar vi en knapp som inte kan funka.
    expect(discordLinkingEnabled()).toBe(false);
  });
});

describe("auktoriserings-URL:en", () => {
  it("begär BARA identify och guilds.join", () => {
    // ⛔ Regressionsvakt mot scope-krypning. `email` är onödigt (vi har en
    // e-post) och `guilds` skulle läsa VARJE server användaren är med i —
    // personuppgifter vi varken behöver eller deklarerar i policyn.
    expect(DISCORD_SCOPES.split(" ").sort()).toEqual(["guilds.join", "identify"]);

    const scope = new URL(buildAuthorizeUrl("abc")).searchParams.get("scope");
    expect(scope).toBe("identify guilds.join");
    expect(scope).not.toContain("email");
    expect(scope).not.toMatch(/(^|\s)guilds(\s|$)/);
  });

  it("bär state och vår callback-URL", () => {
    const url = new URL(buildAuthorizeUrl("state-123"));
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("https://www.foilio.se/api/discord/callback");
  });

  it("callback-URL:en får aldrig dubbla snedstreck (måste matcha portalen ORDAGRANT)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.foilio.se/";
    expect(discordRedirectUri()).toBe("https://www.foilio.se/api/discord/callback");
  });
});

describe("DISCORD_SYNC_SELECT", () => {
  it("innehåller ALLA fyra fält isPro() läser", () => {
    // Ett ovalt fält blir `undefined` → isPro() failar öppet. Det felet syns
    // inte i typer och inte i drift förrän någon får fel roll.
    for (const field of ["planTier", "role", "bonusProUntil", "stripeProUntil"]) {
      expect(DISCORD_SYNC_SELECT, `fältet ${field} saknas`).toHaveProperty(field, true);
    }
  });

  it("hämtar discordUserId — annars vet synken inte vilket konto som ska ändras", () => {
    expect(DISCORD_SYNC_SELECT).toHaveProperty("discordUserId", true);
  });
});

describe("avstängd integration", () => {
  it("syncDiscordRoles rör varken databasen eller Discord", async () => {
    process.env.DISCORD_ENABLED = "false";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await syncDiscordRoles("user-1", "test");
    expect(result).toEqual({ attempted: false, ok: true, pro: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("revokeDiscordRoles är en tyst no-op (kontoradering får aldrig fela på Discord)", async () => {
    process.env.DISCORD_ENABLED = "false";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(revokeDiscordRoles("123", "test")).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("olänkat konto → ingen rollhantering ens när integrationen är PÅ", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await syncDiscordRoles(
      {
        id: "user-1",
        discordUserId: null,
        planTier: "PREMIUM",
        role: "USER",
        bonusProUntil: null,
        stripeProUntil: null,
      },
      "test"
    );
    expect(result.attempted).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("rollsynken följer isPro()", () => {
  /** Fångar varje rollanrop som {metod, rollId}. Discord svarar 204 på allt. */
  function captureRoleCalls() {
    const calls: { method: string; roleId: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const roleId = url.split("/roles/")[1] ?? "";
        calls.push({ method: init?.method ?? "GET", roleId });
        return new Response(null, { status: 204 });
      }
    );
    return calls;
  }

  const BASE = {
    id: "user-1",
    discordUserId: "999",
    role: "USER" as const,
    planTier: "FREE" as const,
    bonusProUntil: null,
    stripeProUntil: null,
  };

  it("Pro-användare får BÅDE Verifierad och Pro", async () => {
    const calls = captureRoleCalls();
    const result = await syncDiscordRoles({ ...BASE, planTier: "PREMIUM" }, "test");
    expect(result).toEqual({ attempted: true, ok: true, pro: true });
    expect(calls).toEqual([
      { method: "PUT", roleId: FULL_ENV.DISCORD_ROLE_VERIFIED },
      { method: "PUT", roleId: FULL_ENV.DISCORD_ROLE_PRO },
    ]);
  });

  it("gratisanvändare BEHÅLLER Verifierad men får Pro borttagen", async () => {
    // Länkningen är inte villkorad av Pro — den som slutar betala ska förbli en
    // verifierad medlem, bara inte längre bära Pro-rollen.
    const calls = captureRoleCalls();
    const result = await syncDiscordRoles(BASE, "test");
    expect(result.pro).toBe(false);
    expect(calls).toEqual([
      { method: "PUT", roleId: FULL_ENV.DISCORD_ROLE_VERIFIED },
      { method: "DELETE", roleId: FULL_ENV.DISCORD_ROLE_PRO },
    ]);
  });

  it("UTGÅNGEN Stripe-prenumeration tas som gratis — det är hela skälet till nattjobbet", async () => {
    // ⛔ Datumbaserad Pro löper ut UTAN att någon webhook fyras. Kan synken inte
    // se det sitter Pro-rollen kvar för alltid hos den som slutat betala.
    const calls = captureRoleCalls();
    const igar = new Date(Date.now() - 86_400_000);
    const result = await syncDiscordRoles({ ...BASE, stripeProUntil: igar }, "test");
    expect(result.pro).toBe(false);
    expect(calls[1]).toEqual({ method: "DELETE", roleId: FULL_ENV.DISCORD_ROLE_PRO });
  });

  it("AKTIV Stripe-prenumeration ger Pro fastän planTier är FREE", async () => {
    // Stripe skriver aldrig planTier (RevenueCat äger det fältet). Missas den
    // grenen får en betalande webbkund ingen Pro-roll.
    const calls = captureRoleCalls();
    const imorgon = new Date(Date.now() + 86_400_000);
    const result = await syncDiscordRoles({ ...BASE, stripeProUntil: imorgon }, "test");
    expect(result.pro).toBe(true);
    expect(calls[1]).toEqual({ method: "PUT", roleId: FULL_ENV.DISCORD_ROLE_PRO });
  });

  it("admin räknas som Pro (samma regel som resten av appen)", async () => {
    const calls = captureRoleCalls();
    const result = await syncDiscordRoles({ ...BASE, role: "ADMIN" }, "test");
    expect(result.pro).toBe(true);
    expect(calls[1].method).toBe("PUT");
  });

  it("ett misslyckat rollanrop rapporteras men KASTAR inte", async () => {
    // Anroparna är betalnings-webhooks och kontoradering. Ett kast där hade
    // fått Stripe att göra om försöket i tre dygn för en rollsättning.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 403 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await syncDiscordRoles({ ...BASE, planTier: "PREMIUM" }, "test");
    expect(result).toEqual({ attempted: true, ok: false, pro: true });
  });

  it("frånkoppling tar bort BÅDA rollerna men rör aldrig medlemskapet", async () => {
    const calls = captureRoleCalls();
    await revokeDiscordRoles("999", "test");
    expect(calls).toEqual([
      { method: "DELETE", roleId: FULL_ENV.DISCORD_ROLE_PRO },
      { method: "DELETE", roleId: FULL_ENV.DISCORD_ROLE_VERIFIED },
    ]);
    // Ingen kick: inget anrop mot /members/{id} utan /roles/.
    expect(calls.every((c) => c.roleId !== "")).toBe(true);
  });

});
