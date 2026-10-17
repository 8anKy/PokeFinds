import { describe, expect, it } from "vitest";
import { isApnsToken } from "@/lib/push";
import { ANDROID_CHANNEL_ID, fcmMessage } from "@/lib/fcm";

describe("push delas upp på tokenformatet", () => {
  it("APNs = 64 hex-tecken, allt annat går till Firebase", () => {
    expect(isApnsToken("a".repeat(64))).toBe(true);
    expect(isApnsToken("0123456789ABCDEF".repeat(4))).toBe(true);
    expect(isApnsToken("dGVzdA:APA91bH-abc_def123")).toBe(false);
    expect(isApnsToken("a".repeat(63))).toBe(false);
  });
});

describe("FCM-meddelandet", () => {
  it("bär kanalen appen skapar och url:en push-manager läser", () => {
    const m = fcmMessage("tok", { title: "T", body: "B", url: "/produkter/x" });
    expect(m.message.android.notification.channel_id).toBe(ANDROID_CHANNEL_ID);
    expect(m.message.data).toEqual({ url: "/produkter/x" });
    expect(m.message.notification).toEqual({ title: "T", body: "B" });
  });
  it("utan url skickas ingen data alls (FCM kräver strängvärden)", () => {
    expect("data" in fcmMessage("tok", { title: "T", body: "B" }).message).toBe(false);
  });
});
