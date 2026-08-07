import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // BREDD ENSAM RÄCKER INTE för att avgöra "desktop": en telefon i LIGGANDE läge
      // är 844–932px bred men bara ~390–430px hög, så allt som bara frågade efter
      // `sm:`/`md:` slog till mitt i appen och webbens toppnavigering dök upp ovanför
      // bottentabbarna. De här skärmarna kräver att ytan också är HÖG nog att vara en
      // riktig desktop/surfplatta (iPad liggande = 768px hög → kvar som förr).
      // Native-appen är dessutom LÅST till porträtt (AndroidManifest + Info.plist);
      // det här är webbens/PWA:ns motsvarighet, och skyddet om OS:et överstyr låset.
      screens: {
        "sm-tall": { raw: "(min-width: 640px) and (min-height: 600px)" },
        "md-tall": { raw: "(min-width: 768px) and (min-height: 600px)" },
      },
      colors: {
        // Foilio design tokens — svart yta, teal signatur.
        // 2026-07-29: ytan gick från charcoal (#0a0a0c/#141417) till RENT SVART.
        // Djupet bärs nu av hårlinjen (border) + inset-highlighten i .card-surface,
        // inte av ett ljusare kort. `overlay` är MED FLIT kvar på #1d1d21: den är
        // ingen bakgrund utan en interaktiv fyllning (hover-rader, aktiva flikar,
        // progress-spår, skeletons) — sänks den till svart försvinner de spåren helt.
        surface: {
          DEFAULT: "#000000",
          raised: "#000000",
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
        // Discord-blurple. Ett TOKEN, inte en hex i en komponent: knappen får se ut
        // som Discord (igenkänning är hela poängen med en "Länka Discord"-knapp),
        // men undantaget ska stå EN gång och gå att hitta. Används bara av
        // Discord-kortet i /installningar.
        discord: {
          DEFAULT: "#5865f2",
          hover: "#4752c4",
        },
        // Tradera. ⛔ Värdet är IDENTISKT med `SOURCE_COLORS.tradera` i
        // product-price-card.tsx med flit: prisgrafens Tradera-serie och den här
        // knappen ska läsa som samma varumärke. Den färgen är dessutom redan
        // kontrastvaliderad mot den svarta ytan i den fyrfärgspaletten — därför
        // återanvänds den i stället för att en andra Tradera-gul uppfinns här.
        // Ändras den ena måste den andra följa med.
        tradera: {
          DEFAULT: "#f5a524",
          hover: "#d08c1f",
        },
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
        // `surface-gradient` (radial charcoal-tvätt uppifrån) är BORTTAGEN 2026-07-29:
        // på den svarta ytan lyste den som ett grått fält i toppen av varje sida.
        // Sidbakgrunden är `bg-surface` = #000, rakt igenom. Lägg inte tillbaka den.
      },
      transitionTimingFunction: {
        // Apple-mjuk utgångskurva för entréer/hover, fjädrande overshoot för "pop"
        "out-soft": "cubic-bezier(0.22, 1, 0.36, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      animation: {
        "fade-in": "fadeIn 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in-up": "fadeInUp 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-in-right": "slideInRight 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        "scale-in": "scaleIn 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
        // Bottensheets (filter/sortering) — glider upp underifrån.
        "slide-up": "slideUp 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 1.6s linear infinite",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
        "counter": "counter 0.6s ease-out both",
        // OBS: fill-mode BACKWARDS, inte both! En fylld opacity-animation håller kvar
        // en STACKING CONTEXT på template-diven för evigt → sidans fixed-dialoger
        // (skannerns z-[60]) hamnar UNDER chrome-header/tabs (z-40, utanför diven).
        // backwards → stacking context bara under 300ms-tonen, sen normal stackning.
        "page-in": "pageIn 0.3s cubic-bezier(0.22, 1, 0.36, 1) backwards",
        "tab-pop": "tabPop 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
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
        // OBS: ENDAST opacity — ingen transform! Template-diven omsluter VARJE sida;
        // en transform på en förfader gör den till containing block för position:fixed-
        // barn (skannerns kameradialog, modaler, sheets) → de fastnar i sidflödet
        // istället för viewporten. animation-fill both håller dessutom kvar transformen
        // för evigt. Buggen sköt sönder skannern 2026-07-20 — lägg ALDRIG tillbaka den.
        pageIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        tabPop: {
          "0%": { transform: "scale(1)" },
          "45%": { transform: "scale(1.18)" },
          "100%": { transform: "scale(1)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
