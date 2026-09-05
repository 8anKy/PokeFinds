"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { IconAlertTriangle, IconCheck, IconInfo, IconX } from "@/components/ui/icons";

export type ToastVariant = "default" | "success" | "error";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** En åtgärdsknapp i toasten ("Ångra"). Toasten lever längre när den finns. */
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DISMISS_MS = 4000;
/** Med en åtgärd måste man hinna läsa OCH trycka. */
const DISMISS_WITH_ACTION_MS = 7000;

const variantClasses: Record<ToastVariant, string> = {
  default: "border-surface-border",
  success: "border-rise/50",
  error: "border-fall/50",
};

const variantIcons: Record<ToastVariant, ReactNode> = {
  default: <IconInfo size={18} className="text-holo-cyan" />,
  success: <IconCheck size={18} className="text-rise" />,
  error: <IconAlertTriangle size={18} className="text-fall" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const tCommon = useTranslations("Common");
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, ...options }]);
      window.setTimeout(() => dismiss(id), options.action ? DISMISS_WITH_ACTION_MS : DISMISS_MS);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        // Lyft ovanför den fixerade bottom-tab-baren på mobil (+ safe-area) så
        // toasten inte hamnar bakom tabbarna/utanför ramen. På desktop (lg) finns
        // ingen tab-bar → vanlig bottom-4.
        className="pointer-events-none fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[70] ml-auto flex w-auto max-w-sm flex-col gap-2 lg:inset-x-auto lg:right-4 lg:bottom-4"
      >
        {toasts.map((t) => {
          const variant = t.variant ?? "default";
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                "pointer-events-auto animate-slide-in-right rounded-xl border bg-surface-overlay p-4 shadow-card",
                variantClasses[variant]
              )}
            >
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-0.5 shrink-0">
                  {variantIcons[variant]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{t.title}</p>
                  {t.description && (
                    <p className="mt-0.5 text-sm text-ink-muted">{t.description}</p>
                  )}
                </div>
                {t.action && (
                  <button
                    type="button"
                    onClick={() => {
                      t.action?.onClick();
                      dismiss(t.id);
                    }}
                    className="shrink-0 rounded-lg border border-holo-cyan/40 px-2.5 py-1 text-sm font-semibold text-holo-cyan transition-colors hover:bg-holo-cyan/10"
                  >
                    {t.action.label}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label={tCommon("closeNotification")}
                  className="rounded p-1 text-ink-faint transition-colors hover:text-ink"
                >
                  <IconX size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast måste användas inom <ToastProvider>");
  }
  return ctx;
}
