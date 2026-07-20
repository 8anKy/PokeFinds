import { PageTransition } from "@/components/layout/page-transition";

// Template (ej layout) → remountar per navigering: sidinnehållet tonar in
// mjukt medan chrome (header/tabs i layouten ovanför) står stilla.
// Animationsklassen städas bort efter avslut — se PageTransition för varför
// det är KRITISKT (stacking context-fällan som bröt skannern).
export default function MarketingTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
