import { describe, it, expect, beforeEach } from "vitest";
import { setAuthHint, hasAuthHint } from "@/lib/auth-hint";

// Plain-object document-stub (node-env, ingen jsdom): assignment ersätter strängen,
// vilket räcker för att verifiera set/clear + att parsningen inte delmatchar.
describe("auth-hint", () => {
  beforeEach(() => {
    (globalThis as { document?: { cookie: string } }).document = { cookie: "" };
    // setAuthHint kallar window.dispatchEvent → stubba window i node-env.
    (globalThis as { window?: { dispatchEvent: () => boolean } }).window = {
      dispatchEvent: () => true,
    };
  });

  it("round-trippar inloggad-hinten", () => {
    expect(hasAuthHint()).toBe(false);
    setAuthHint(true);
    expect(hasAuthHint()).toBe(true);
    setAuthHint(false);
    expect(hasAuthHint()).toBe(false);
  });

  it("delmatchar inte en annan cookie", () => {
    (globalThis as { document?: { cookie: string } }).document = { cookie: "x_fo_auth=1zz" };
    expect(hasAuthHint()).toBe(false);
  });
});
