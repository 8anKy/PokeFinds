import { describe, expect, it } from "vitest";
import { loginHintKey } from "@/lib/login-hint";

describe("loginHintKey", () => {
  it("pekar ut varför man hamnade på inloggningen", () => {
    expect(loginHintKey("/samling")).toBe("hintCollection");
    expect(loginHintKey("/samling?tab=sets")).toBe("hintCollection");
    expect(loginHintKey("/bevakningar")).toBe("hintWatches");
    expect(loginHintKey("/forum/ny?group=allmant")).toBe("hintForumPost");
    expect(loginHintKey("/mer")).toBe("hintMore");
  });

  it("språkprefix och absoluta URL:er räknas som samma väg", () => {
    expect(loginHintKey("/en/samling")).toBe("hintCollection");
    expect(loginHintKey("https://foilio.se/en/bevakningar")).toBe("hintWatches");
  });

  it("okänd väg, tomt eller skräp ⇒ ingen rad", () => {
    expect(loginHintKey("/produkter")).toBeNull();
    expect(loginHintKey("")).toBeNull();
    expect(loginHintKey(null)).toBeNull();
    expect(loginHintKey("/samlingar")).toBeNull(); // prefix-fällan: inte /samling
    expect(loginHintKey("http://[bad")).toBeNull();
  });
});
