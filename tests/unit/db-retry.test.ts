import { describe, it, expect } from "vitest";
import { isRetryableDbError } from "../../src/lib/db";

// VARFÖR DET HÄR TESTET FINNS (2026-08-04): den dagliga Cardmarket-körningen dog efter
// SEX SEKUNDER på sin allra första fråga och hela dygnets priser uteblev. Neon hade
// skalat till noll (meningen), och Prisma kastade då en `PrismaClientInitializationError`
// med `errorCode: undefined` — alltså UTAN någon av de koder vakten letade efter.
// Vakten läste bara `err.code` och kastade felet vidare som om frågan varit trasig.
//
// Lärdomen är den återkommande: EN VAKT SOM BARA KÄNNER IGEN ETT FÄLT FAILAR ÖPPET när
// leverantören slutar fylla i det. Därför tre oberoende signaler — kod, namn och text.

describe("isRetryableDbError", () => {
  it("känner igen kallstarten som dödade 2026-08-04 (init-fel UTAN kod)", () => {
    // Exakt formen ur Actions-loggen: namn + text, inga koder.
    const err = Object.assign(
      new Error(
        "Invalid `prisma.retailer.findFirst()` invocation\n" +
          "Can't reach database server at `ep-broad-dust-as7mb6ud.c-4.eu-central-1.aws.neon.tech:5432`",
      ),
      { name: "PrismaClientInitializationError", clientVersion: "5.22.0", errorCode: undefined },
    );
    expect(isRetryableDbError(err)).toBe(true);
  });

  it("känner igen texten även om namnet skulle byta", () => {
    expect(isRetryableDbError(new Error("Can't reach database server at foo:5432"))).toBe(true);
  });

  it("känner fortfarande igen de kodade anslutningsfelen", () => {
    for (const code of ["P1017", "P1001", "P2024"]) {
      expect(isRetryableDbError(Object.assign(new Error("x"), { code }))).toBe(true);
    }
    // Vissa Prisma-fel bär koden på `errorCode` i stället för `code`.
    expect(isRetryableDbError(Object.assign(new Error("x"), { errorCode: "P1001" }))).toBe(true);
  });

  it("⛔ retryar ALDRIG ett riktigt frågefel", () => {
    // P2002 = unik-krock, P2025 = raden finns inte, 42703 = kolumnen finns inte.
    // Att försöka igen ändrar ingenting och döljer buggen bakom fyra väntor.
    for (const code of ["P2002", "P2025", "P2010"]) {
      expect(isRetryableDbError(Object.assign(new Error("x"), { code }))).toBe(false);
    }
    expect(isRetryableDbError(new Error('column "source" does not exist'))).toBe(false);
    expect(isRetryableDbError(null)).toBe(false);
    expect(isRetryableDbError(undefined)).toBe(false);
  });
});
