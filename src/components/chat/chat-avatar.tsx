import { cn } from "@/lib/utils";
import { avatarInitial } from "@/lib/chat-rules";

/** Rund avatar: bilden om den finns, annars initialen på holo-gradienten (som profilen). */
export function ChatAvatar({
  name,
  avatarUrl,
  size = 44,
  className,
}: {
  name: string | null;
  avatarUrl: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        style={style}
        className={cn("shrink-0 rounded-full border border-surface-border object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-display font-bold text-surface",
        name ? "bg-holo-gradient" : "bg-surface-overlay text-ink-faint",
        className
      )}
    >
      {avatarInitial(name)}
    </span>
  );
}
