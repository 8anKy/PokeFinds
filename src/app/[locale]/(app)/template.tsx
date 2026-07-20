import { PageTransition } from "@/components/layout/page-transition";

// Template (ej layout) → remountar per navigering: sidinnehållet tonar in
// mjukt medan AppShell/chrome står stilla. Animationsklassen städas bort efter
// avslut — se PageTransition för varför det är KRITISKT (stacking context-
// fällan som bröt skannern).
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
