"use client";

import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

const fieldClasses =
  "w-full rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-holo-cyan focus:outline-none focus:ring-2 focus:ring-holo-cyan/30 disabled:cursor-not-allowed disabled:opacity-50";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref
) {
  return <input ref={ref} className={cn(fieldClasses, "h-10", className)} {...props} />;
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...props },
  ref
) {
  return (
    <textarea ref={ref} className={cn(fieldClasses, "min-h-[96px]", className)} {...props} />
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...props },
  ref
) {
  return (
    <select ref={ref} className={cn(fieldClasses, "h-10 appearance-none", className)} {...props}>
      {children}
    </select>
  );
});

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn("mb-1.5 block text-sm font-medium text-ink", className)}
      {...props}
    />
  );
}

export interface FieldErrorProps {
  message?: string | null;
  className?: string;
}

export function FieldError({ message, className }: FieldErrorProps) {
  if (!message) return null;
  return (
    <p role="alert" className={cn("mt-1.5 text-sm text-fall", className)}>
      {message}
    </p>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, id, ...props },
  ref
) {
  const checkbox = (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      className={cn(
        "h-4 w-4 cursor-pointer rounded border-surface-border bg-surface-raised text-holo-cyan accent-holo-cyan focus:ring-2 focus:ring-holo-cyan/30 focus:ring-offset-0",
        className
      )}
      {...props}
    />
  );

  if (!label) return checkbox;

  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
      {checkbox}
      {label}
    </label>
  );
});
