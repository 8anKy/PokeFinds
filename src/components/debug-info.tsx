"use client";

// TEMPORÄR diagnostik för mobil-appen. Tas bort efter felsökning.
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { hasAuthHint } from "@/lib/auth-hint";

export function DebugInfo() {
  const [info, setInfo] = useState<string>("…");
  useEffect(() => {
    setInfo(
      [
        `inner ${window.innerWidth}x${window.innerHeight}`,
        `screen ${window.screen.width}`,
        `dpr ${window.devicePixelRatio}`,
        `platform ${Capacitor.getPlatform()}`,
        `native ${Capacitor.isNativePlatform()}`,
        `rcKey ${process.env.NEXT_PUBLIC_RC_IOS_KEY ? "yes" : "NO"}`,
        `auth ${hasAuthHint()}`,
      ].join(" · ")
    );
  }, []);
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        bottom: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.85)",
        color: "#2dd4bf",
        font: "11px/1.4 monospace",
        padding: "4px 8px",
        maxWidth: "100vw",
        wordBreak: "break-all",
      }}
    >
      {info}
    </div>
  );
}
