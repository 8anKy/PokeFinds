// Template (ej layout) → remountar per navigering: sidinnehållet tonar in
// mjukt medan chrome (header/tabs i layouten ovanför) står stilla. Ren CSS,
// server-komponent — påverkar inte ISR. Reduced motion nollas i globals.css.
export default function MarketingTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
