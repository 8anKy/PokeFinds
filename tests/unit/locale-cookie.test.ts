import { describe, it, expect } from "vitest";
import {
  LOCALE_COOKIE_NAME,
  dropSetCookie,
  setCookieName,
  shouldDropLocaleCookie,
} from "@/lib/locale-cookie";

// Domarna bakom strykningen av `NEXT_LOCALE` ligger på AUTENTISERINGENS KRITISKA
// VÄG (middleware). Testet finns för att de tre egenskaper som gör ändringen
// ofarlig ska gå att bevisa utan Request/Response — inte för att täcka rader:
//   1. en inloggad påverkas ALDRIG,
//   2. `fo_auth`- och `fo_ref`-cookiesarna överlever strykningen,
//   3. en riktig webbläsare (som alltid skickar Accept-Language) ser ingen skillnad.
// 1 och 2 kodar var sin dokumenterad incident: hinten som WebKit kapade till sju
// dygn, och kreatörsattributionen som måste överleva en omdirigering.

describe("shouldDropLocaleCookie", () => {
  it("rör ALDRIG en inloggad — inte ens utan Accept-Language", () => {
    expect(shouldDropLocaleCookie(null, true)).toBe(false);
    expect(shouldDropLocaleCookie("", true)).toBe(false);
    expect(shouldDropLocaleCookie(undefined, true)).toBe(false);
  });

  it("låter en riktig webbläsare vara i fred", () => {
    // Varje webbläsare skickar headern — det är hela skälet till att den är grinden
    // i stället för en UA-lista (som är färskvara, se blocked-bots.ts).
    expect(shouldDropLocaleCookie("sv-SE,sv;q=0.9,en;q=0.8", false)).toBe(false);
    expect(shouldDropLocaleCookie("en-US", false)).toBe(false);
    expect(shouldDropLocaleCookie("*", false)).toBe(false);
  });

  it("stryker för utloggade klienter som utelämnar headern (crawlers, curl)", () => {
    expect(shouldDropLocaleCookie(null, false)).toBe(true);
    expect(shouldDropLocaleCookie(undefined, false)).toBe(true);
  });

  it("räknar en header som bara är blanksteg som saknad", () => {
    // Node normaliserar inte bort en tom header åt oss; `"   "` hade annars
    // passerat som ett språkval och gjort svaret ocachebart i onödan.
    expect(shouldDropLocaleCookie("", false)).toBe(true);
    expect(shouldDropLocaleCookie("   ", false)).toBe(true);
  });
});

describe("setCookieName", () => {
  it("läser namnet ur en riktig Set-Cookie-sträng", () => {
    expect(setCookieName("NEXT_LOCALE=sv; Path=/; SameSite=lax")).toBe("NEXT_LOCALE");
    expect(setCookieName("fo_auth=1; Path=/; Max-Age=31536000")).toBe("fo_auth");
  });

  it("klarar ett tomt värde — så en RADERANDE cookie matchar på namn", () => {
    // `fo_auth` nollställs med tomt värde vid utloggning; matchar den inte på namn
    // kan en framtida filtrering missa den.
    expect(setCookieName("fo_auth=; Path=/; Max-Age=0")).toBe("fo_auth");
  });

  it("tappar inte namnet när värdet självt innehåller likhetstecken", () => {
    // JWT:er i base64 slutar ofta på "=" — namnet är allt före FÖRSTA likhetstecknet.
    expect(setCookieName("next-auth.session-token=eyJhbGc=.abc=; Path=/")).toBe(
      "next-auth.session-token"
    );
  });

  it("kastar inte på en attributlös sträng", () => {
    expect(setCookieName("NEXT_LOCALE=sv")).toBe("NEXT_LOCALE");
    expect(setCookieName("")).toBe("");
  });
});

describe("dropSetCookie", () => {
  function headersWith(...cookies: string[]): Headers {
    const h = new Headers();
    for (const c of cookies) h.append("set-cookie", c);
    return h;
  }

  it("⛔ LÅTER fo_auth OCH fo_ref VARA KVAR — båda kodar en incident", () => {
    const h = headersWith(
      "fo_auth=1; Path=/; Max-Age=31536000; SameSite=lax",
      "NEXT_LOCALE=sv; Path=/; SameSite=lax",
      "fo_ref=EMMA; Path=/; Max-Age=2592000; SameSite=lax"
    );
    dropSetCookie(h, LOCALE_COOKIE_NAME);
    const left = h.getSetCookie();
    expect(left).toHaveLength(2);
    expect(left.map(setCookieName).sort()).toEqual(["fo_auth", "fo_ref"]);
    expect(left.some((c) => c.startsWith("NEXT_LOCALE"))).toBe(false);
  });

  it("bevarar attributen på de cookies som blir kvar", () => {
    // Filtreringen bygger om headern rad för rad — tappas attributen får `fo_auth`
    // fel livslängd och iOS-utloggningen från 2026-08-06 är tillbaka.
    const h = headersWith(
      "NEXT_LOCALE=sv; Path=/",
      "fo_auth=1; Path=/; Max-Age=31536000; SameSite=lax"
    );
    dropSetCookie(h, LOCALE_COOKIE_NAME);
    expect(h.getSetCookie()).toEqual([
      "fo_auth=1; Path=/; Max-Age=31536000; SameSite=lax",
    ]);
  });

  it("rör inte headern alls när cookien inte finns där", () => {
    const h = headersWith("fo_auth=1; Path=/");
    dropSetCookie(h, LOCALE_COOKIE_NAME);
    expect(h.getSetCookie()).toEqual(["fo_auth=1; Path=/"]);
  });

  it("är en no-op på en tom header", () => {
    const h = new Headers();
    expect(() => dropSetCookie(h, LOCALE_COOKIE_NAME)).not.toThrow();
    expect(h.getSetCookie()).toEqual([]);
  });

  it("stryker alla förekomster om cookien råkat sättas två gånger", () => {
    const h = headersWith(
      "NEXT_LOCALE=sv; Path=/",
      "fo_auth=1; Path=/",
      "NEXT_LOCALE=en; Path=/"
    );
    dropSetCookie(h, LOCALE_COOKIE_NAME);
    expect(h.getSetCookie()).toEqual(["fo_auth=1; Path=/"]);
  });

  it("gör INGENTING när runtimen saknar getSetCookie", () => {
    // Utan `getSetCookie` går flera cookies inte att dela isär säkert ur EN sträng.
    // Att gissa vore ett fel i autentiseringens väg; det här är bara en cache-vinst.
    const fake = {
      getSetCookie: undefined,
      delete: () => {
        throw new Error("headern fick inte röras");
      },
      append: () => {
        throw new Error("headern fick inte röras");
      },
    } as unknown as Headers;
    expect(() => dropSetCookie(fake, LOCALE_COOKIE_NAME)).not.toThrow();
  });
});
