import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { importSPKI, jwtVerify } from "jose";
import { buildAppleClientSecret } from "@/lib/apple-client-secret";
import { baseDisplayName, uniqueDisplayName } from "@/lib/display-name";

/**
 * Google-/Apple-inloggning (2026-08-29). Tre saker som går sönder TYST:
 *
 *  1. Apples client secret är en JWT vi signerar själva. Fel alg/encoding ger
 *     "invalid_client" hos Apple — i drift, aldrig i en typkontroll.
 *  2. `User.name` är case-insensitivt unikt: ett odedupat Google-namn kastar
 *     P2002 mitt i inloggningen.
 *  3. Nativa bygget: pluginet, URL-schemat, entitlementen och `allowNavigation`
 *     är fyra filer som måste vara eniga — och ingen av dem körs i CI.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("Apple client secret", () => {
  it("är en ES256-JWT Apple accepterar (iss=team, sub=client, aud=appleid, ≤6 mån)", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const now = new Date("2026-08-29T12:00:00Z");
    const secret = buildAppleClientSecret({
      teamId: "TEAM123456",
      keyId: "KEY1234567",
      clientId: "se.foilio.web",
      privateKey: pem.replace(/\n/g, "\\n"), // env-formen: escapade radbrytningar
      now,
    });
    const pub = await importSPKI(publicKey.export({ type: "spki", format: "pem" }).toString(), "ES256");
    const { payload, protectedHeader } = await jwtVerify(secret, pub, {
      issuer: "TEAM123456",
      audience: "https://appleid.apple.com",
      subject: "se.foilio.web",
      currentDate: now,
    });
    expect(protectedHeader).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(15_777_000);
  });
});

describe("visningsnamn", () => {
  it("tar leverantörens namn, annars e-postens lokaldel, annars 'Samlare'", () => {
    expect(baseDisplayName("  Anna   Svensson ", "x@y.se")).toBe("Anna Svensson");
    expect(baseDisplayName(null, "anna.svensson+tcg@gmail.com")).toBe("anna svensson tcg");
    expect(baseDisplayName("A", "a@b.se")).toBe("Samlare");
    expect(baseDisplayName("x".repeat(200), null)).toHaveLength(80);
  });

  it("deduppar med suffix och håller sig under 80 tecken", async () => {
    const taken = new Set(["anna", "anna 2"]);
    const isTaken = async (c: string) => taken.has(c.toLowerCase());
    expect(await uniqueDisplayName("Anna", isTaken)).toBe("Anna 3");
    expect(await uniqueDisplayName("Bertil", isTaken)).toBe("Bertil");
    const long = "y".repeat(80);
    const longTaken = async (c: string) => c === long;
    expect(await uniqueDisplayName(long, longTaken)).toHaveLength(80);
  });
});

describe("nativt bygge — fyra filer måste vara eniga", () => {
  it("Capacitor buntar google+apple och släpper in Apples webbflöde", () => {
    const cfg = read("capacitor.config.ts");
    expect(cfg).toMatch(/SocialLogin:\s*\{[\s\S]*google:\s*true[\s\S]*apple:\s*true/);
    expect(cfg).toContain('"appleid.apple.com"');
    // Google ska ALDRIG stå där — deras flöde är blockerat i WebViews, appen kör nativt.
    expect(cfg).not.toMatch(/allowNavigation:[\s\S]*?"accounts\.google\.com"/);
  });

  it("iOS: URL-schema för Google-återhopp + Sign in with Apple-entitlement kopplad", () => {
    const plist = read("ios/App/App/Info.plist");
    expect(plist).toContain("<key>GIDClientID</key>");
    expect(plist).toMatch(/<string>com\.googleusercontent\.apps\./);
    const ent = read("ios/App/App/App.entitlements");
    expect(ent).toContain("com.apple.developer.applesignin");
    expect(ent).toContain("aps-environment");
    const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
    expect(pbx.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g)).toHaveLength(2);
  });

  it("pluginet är ett deklarerat beroende", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@capgo/capacitor-social-login"]).toBeTruthy();
    expect(pkg.dependencies["jose"]).toBeTruthy();
  });
});

describe("lösenordsvägen tål konton utan lösenord", () => {
  it("authorize() nekar när passwordHash är null i stället för att kasta", () => {
    const auth = read("src/lib/auth.ts");
    expect(auth).toContain("!!user?.passwordHash && (await bcrypt.compare(");
  });
});
