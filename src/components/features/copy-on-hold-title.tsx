"use client";

import { useRef } from "react";
import { useToast } from "@/components/ui/toast";

// Långtryck (~500 ms) på produktnamnet kopierar det — ersätter den avstängda
// markera-och-kopiera-gesten. ponytail: enkel timer, ingen press-feedback-anim.
export function CopyOnHoldTitle({ text, className }: { text: string; className?: string }) {
  const { toast } = useToast();
  const timer = useRef<number | null>(null);

  function start() {
    timer.current = window.setTimeout(() => {
      void navigator.clipboard
        .writeText(text)
        .then(() => toast({ title: "Namnet kopierat", variant: "success" }))
        .catch(() => toast({ title: "Kunde inte kopiera", variant: "error" }));
    }, 500);
  }

  function cancel() {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  return (
    <h1
      className={className}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
    >
      {text}
    </h1>
  );
}
