"use client";

// TEMPORÄR diagnostik för safe-area/scroll. Tas bort efter felsökning.
import { useEffect, useState } from "react";

export function DebugInfo() {
  const [s, setS] = useState("…");
  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const top = cs.paddingTop;
    const bot = cs.paddingBottom;
    probe.remove();
    const upd = () =>
      setS(
        `safe ${top}/${bot} · scrollY ${Math.round(window.scrollY)} · inner ${window.innerHeight}`
      );
    upd();
    window.addEventListener("scroll", upd, { passive: true });
    return () => window.removeEventListener("scroll", upd);
  }, []);
  return (
    <div
      style={{
        position: "fixed",
        top: "40%",
        left: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.85)",
        color: "#2dd4bf",
        font: "12px monospace",
        padding: "4px 8px",
      }}
    >
      {s}
    </div>
  );
}
