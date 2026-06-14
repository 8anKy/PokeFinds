import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-surface-border bg-surface-raised/50">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <p className="text-lg font-bold">
            Poke<span className="holo-text">Finds</span>
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            Din kontrollpanel för Pokémon TCG-marknaden. Bevaka priser,
            lagerstatus och värdet på din samling.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Tjänsten</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-muted">
            <li><Link href="/produkter" className="transition-colors duration-150 hover:text-ink">Utforska produkter</Link></li>
            <li><Link href="/marknad" className="transition-colors duration-150 hover:text-ink">Marknadstrender</Link></li>
            <li><Link href="/skanna" className="transition-colors duration-150 hover:text-ink">Skanna kort</Link></li>
            <li><Link href="/priser" className="transition-colors duration-150 hover:text-ink">Priser & Premium</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Community</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-muted">
            <li><Link href="/community" className="transition-colors duration-150 hover:text-ink">Flödet</Link></li>
            <li><Link href="/community?kategori=PULLS" className="transition-colors duration-150 hover:text-ink">Pulls</Link></li>
            <li><Link href="/community?kategori=TRADES" className="transition-colors duration-150 hover:text-ink">Trades</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Om & Juridik</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-muted">
            <li><Link href="/om" className="transition-colors duration-150 hover:text-ink">Om PokeFinds</Link></li>
            <li><Link href="/kontakt" className="transition-colors duration-150 hover:text-ink">Kontakt</Link></li>
            <li><Link href="/villkor" className="transition-colors duration-150 hover:text-ink">Användarvillkor</Link></li>
            <li><Link href="/integritetspolicy" className="transition-colors duration-150 hover:text-ink">Integritetspolicy</Link></li>
            <li><Link href="/cookies" className="transition-colors duration-150 hover:text-ink">Cookiepolicy</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-surface-border px-4 py-4 text-center text-xs text-ink-faint">
        © {new Date().getFullYear()} PokeFinds. Pokémon och alla relaterade namn är varumärken som
        tillhör sina respektive ägare. PokeFinds är en oberoende tjänst.
      </div>
    </footer>
  );
}
