import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // PokeFinds design tokens — neutral charcoal dark theme, teal signature
        surface: {
          DEFAULT: "#0a0a0c",
          raised: "#141417",
          overlay: "#1d1d21",
          border: "#2a2a30",
        },
        ink: {
          DEFAULT: "#fafafa",
          muted: "#a1a1aa",
          faint: "#8a8a93",
        },
        holo: {
          cyan: "#2dd4bf",
          violet: "#a78bfa",
          pink: "#f472b6",
          gold: "#f59e0b",
        },
        rise: "#22c55e",
        fall: "#f43f5e",
        brand: {
          DEFAULT: "#2dd4bf",
          dark: "#0f766e",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(45, 212, 191, 0.35), 0 0 24px -4px rgba(45, 212, 191, 0.30)",
        "glow-violet": "0 0 24px -4px rgba(167, 139, 250, 0.30)",
        card: "0 1px 0 0 rgba(255, 255, 255, 0.03) inset, 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px -12px rgba(0, 0, 0, 0.6)",
      },
      backgroundImage: {
        "holo-gradient":
          "linear-gradient(135deg, #2dd4bf 0%, #14b8a6 55%, #0f766e 100%)",
        "surface-gradient":
          "radial-gradient(120% 80% at 50% 0%, #16161a 0%, #0a0a0c 55%)",
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out both",
        "fade-in-up": "fadeInUp 0.5s ease-out both",
        "slide-in-right": "slideInRight 0.4s ease-out both",
        "scale-in": "scaleIn 0.3s ease-out both",
        shimmer: "shimmer 1.6s linear infinite",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
        "counter": "counter 0.6s ease-out both",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          "0%": { opacity: "0", transform: "translateX(-12px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        counter: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
