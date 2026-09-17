import { NextResponse } from "next/server";
import { nordiskCartForm } from "@/lib/cart-url";

/**
 * KORG-BRYGGA för butiker vars korg bara tar POST (Nordisk e-handel: MaxGaming,
 * Spelexperten — se src/lib/cart-url.ts). Restock-pushen/Pro-kanalen/mejlet länkar hit;
 * sidan skickar formuläret till butiken direkt så användaren landar med varan i korgen.
 *
 * DB-FRI OCH SESSIONSFRI MED FLIT: utdata beror bara på query-strängen, så svaret cachas
 * publikt ett dygn (Railway-kanten + browsern). Ingen Neon-väckning per larm-tryck.
 * ⛔ Bara hosts i `NORDISK_CART_SHOPS` — allt annat 400, aldrig ett formulär mot en
 *    främmande sajt. Värdena HTML-escapas (de kommer ur URL:en).
 * ⛔ `<noscript>`/knappen är inte dekoration: Capacitor öppnar länken i systemwebbläsaren,
 *    men en läsare med JS av ska fortfarande kunna trycka sig vidare.
 */
export const dynamic = "force-dynamic";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const form = nordiskCartForm(searchParams.get("shop"), searchParams.get("artnr"));
  if (!form) return new NextResponse("Okänd butik eller artikel.", { status: 400 });

  const inputs = Object.entries(form.fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  const html = `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Lägger i korgen hos ${esc(form.shopName)} · Foilio</title>
<style>
html,body{margin:0;min-height:100%;background:#000;color:#fff;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center}
p{margin:0;color:#a1a1aa}
button{background:#2dd4bf;color:#000;border:0;border-radius:999px;padding:14px 28px;font:inherit;font-weight:700;cursor:pointer}
.spin{width:28px;height:28px;border:3px solid #27272a;border-top-color:#2dd4bf;border-radius:50%;animation:s .8s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
</style></head><body><main>
<div class="spin" aria-hidden="true"></div>
<p>Lägger varan i din korg hos ${esc(form.shopName)} …</p>
<form method="post" action="${esc(form.action)}" id="f">${inputs}<button type="submit">Lägg i korgen hos ${esc(form.shopName)}</button></form>
<script>document.getElementById("f").submit()</script>
</main></body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
      "referrer-policy": "no-referrer",
    },
  });
}
