import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetHub,
  connectionCount,
  encodeSse,
  isConnected,
  publish,
  subscribe,
  type ChatEvent,
} from "@/lib/chat-hub";

const msg = (id: string): ChatEvent => ({
  type: "message",
  conversationId: "c1",
  message: { id, senderId: "u1", body: "hej", createdAt: "2026-09-03T10:00:00.000Z" },
});

describe("chat-hub", () => {
  beforeEach(() => _resetHub());

  it("levererar till alla strömmar en användare har öppna, ingen annan", () => {
    const got: string[] = [];
    subscribe("u2", (e) => got.push("a:" + e.type));
    subscribe("u2", (e) => got.push("b:" + e.type));
    subscribe("u3", (e) => got.push("c:" + e.type));
    expect(publish("u2", msg("m1"))).toBe(2);
    expect(got).toEqual(["a:message", "b:message"]);
  });

  it("isConnected speglar öppna strömmar och avregistrering städar", () => {
    expect(isConnected("u2")).toBe(false);
    const off = subscribe("u2", () => undefined);
    expect(isConnected("u2")).toBe(true);
    expect(connectionCount()).toBe(1);
    off();
    expect(isConnected("u2")).toBe(false);
    expect(connectionCount()).toBe(0);
    // dubbel avregistrering är ofarlig
    off();
    expect(publish("u2", msg("m2"))).toBe(0);
  });

  it("en kastande lyssnare stoppar inte de andra", () => {
    const got: string[] = [];
    subscribe("u2", () => {
      throw new Error("trasig ström");
    });
    subscribe("u2", (e) => got.push(e.type));
    expect(publish("u2", msg("m3"))).toBe(1);
    expect(got).toEqual(["message"]);
  });

  it("SSE-formatet: event-rad, data-rad, tom rad", () => {
    const s = encodeSse(msg("m4"));
    expect(s.startsWith("event: message\ndata: {")).toBe(true);
    expect(s.endsWith("\n\n")).toBe(true);
    expect(JSON.parse(s.split("\ndata: ")[1].trim()).message.id).toBe("m4");
  });
});
