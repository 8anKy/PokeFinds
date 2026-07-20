// Template (ej layout) → remountar per navigering: sidinnehållet tonar in
// mjukt medan AppShell/chrome står stilla. Ren CSS, server-komponent.
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
