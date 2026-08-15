import { describe, expect, it } from "vitest";
import { interpretResendEvent } from "@/lib/mail-status";

describe("interpretResendEvent", () => {
  it("dömer bara terminala fel som ej levererat", () => {
    expect(interpretResendEvent("bounced")).toBe("undeliverable");
    expect(interpretResendEvent("failed")).toBe("undeliverable");
    expect(interpretResendEvent("suppressed")).toBe("undeliverable");
  });

  it("räknar leverans som leverans, även efter öppning", () => {
    expect(interpretResendEvent("delivered")).toBe("delivered");
    expect(interpretResendEvent("opened")).toBe("delivered");
    expect(interpretResendEvent("clicked")).toBe("delivered");
  });

  it("⛔ delivery_delayed är INTE en studs", () => {
    // Resend beskriver det som ett TILLFÄLLIGT fel hos mottagarens server.
    // Läser vi det som en studs skickar vi tillbaka någon som strax får sin
    // kod till formuläret — och den koden gäller fortfarande.
    expect(interpretResendEvent("delivery_delayed")).toBe("pending");
  });

  it("⛔ complained betyder att mejlet KOM FRAM", () => {
    // Spamanmälan sker efter leverans. Koden ligger i skräpposten, och
    // "adressen gick inte att nå" hade varit fel besked.
    expect(interpretResendEvent("complained")).toBe("delivered");
  });

  it("behandlar mellanlägen som pending", () => {
    for (const event of ["sent", "queued", "scheduled"]) {
      expect(interpretResendEvent(event)).toBe("pending");
    }
  });

  it("okänt, saknat eller ogiltigt värde är pending — aldrig en studs", () => {
    // Resend kan lägga till händelser; en ny etikett får inte tolkas som ett fel.
    for (const value of [undefined, null, "", 42, {}, "some_new_event_2027"]) {
      expect(interpretResendEvent(value)).toBe("pending");
    }
  });

  it("är okänslig för versaler", () => {
    expect(interpretResendEvent("Bounced")).toBe("undeliverable");
    expect(interpretResendEvent("DELIVERED")).toBe("delivered");
  });
});
