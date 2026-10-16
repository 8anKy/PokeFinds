/**
 * Varje era får en egen ton (Scoutrs fyra holofärger i tur och ordning) — ett svagt sken
 * bakom loggorna och en prick vid rubriken. Delad av /sets och set-arket i Utforska så att
 * de ser likadana ut. Hela klassnamn, så Tailwind ser dem.
 */
import { eraRank, type Era } from "@/lib/set-era";

export const ERA_TONES = [
  { glow: "from-holo-gold/25", dot: "bg-holo-gold", ring: "hover:border-holo-gold/60" },
  { glow: "from-holo-violet/25", dot: "bg-holo-violet", ring: "hover:border-holo-violet/60" },
  { glow: "from-holo-cyan/25", dot: "bg-holo-cyan", ring: "hover:border-holo-cyan/60" },
  { glow: "from-holo-pink/25", dot: "bg-holo-pink", ring: "hover:border-holo-pink/60" },
] as const;
export type Tone = (typeof ERA_TONES)[number];
export const toneFor = (era: Era): Tone => ERA_TONES[eraRank(era) % ERA_TONES.length];
