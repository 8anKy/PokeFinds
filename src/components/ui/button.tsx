"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-holo-cyan text-surface font-semibold hover:shadow-glow hover:bg-holo-cyan/90 active:bg-holo-cyan/80",
  secondary:
    "bg-surface-overlay text-ink hover:bg-surface-border active:bg-surface-overlay/80 border border-surface-border",
  ghost: "bg-transparent text-ink-muted hover:bg-surface-overlay hover:text-ink",
  danger: "bg-fall/90 text-surface font-semibold hover:bg-fall active:bg-fall/80",
  outline:
    "bg-transparent border border-holo-cyan/50 text-holo-cyan hover:bg-holo-cyan/10 hover:border-holo-cyan",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

const baseClasses =
  "inline-flex items-center justify-center rounded-lg transition-all duration-200 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    >
      {loading && <Spinner size="sm" className="text-current" />}
      {children}
    </button>
  );
});

export interface LinkButtonProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  prefetch?: boolean;
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  prefetch,
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
    >
      {children}
    </Link>
  );
}
