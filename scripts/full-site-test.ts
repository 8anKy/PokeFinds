async function test(label: string, url: string, check: (body: string, status: number) => boolean): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    const body = await res.text();
    const ok = check(body, res.status);
    console.log((ok ? "PASS" : "FAIL") + " " + label + (ok ? "" : ` (status=${res.status}, body=${body.slice(0, 100)})`));
    return ok;
  } catch (e) {
    console.log("ERR  " + label + ": " + (e as Error).message?.slice(0, 80));
    return false;
  }
}

async function main() {
  let pass = 0, fail = 0;
  const t = async (label: string, url: string, check: (body: string, status: number) => boolean) => {
    (await test(label, url, check)) ? pass++ : fail++;
  };

  console.log("=== PAGE TESTS ===\n");
  await t("Landing page", "http://localhost:3000/", (_, s) => s === 200);
  await t("Products catalog", "http://localhost:3000/produkter", (b, s) => s === 200 && b.includes("Utforska"));
  await t("Sets page", "http://localhost:3000/sets", (_, s) => s === 200);
  await t("Market page", "http://localhost:3000/marknad", (_, s) => s === 200);
  await t("Login page", "http://localhost:3000/logga-in", (_, s) => s === 200);
  await t("Pricing page", "http://localhost:3000/priser", (_, s) => s === 200);
  await t("Community page", "http://localhost:3000/community", (_, s) => s === 200);
  await t("Sitemap", "http://localhost:3000/sitemap.xml", (b, s) => s === 200 && b.includes("<urlset"));
  await t("Dashboard redirect", "http://localhost:3000/dashboard", (_, s) => s === 307);

  console.log("\n=== PRODUCT DETAIL PAGES ===\n");
  // Get some product slugs from different categories
  const res = await fetch("http://localhost:3000/api/products?query=&pageSize=100");
  const data = await res.json();
  const categories = new Set<string>();
  const testProducts: { slug: string; title: string; category: string }[] = [];
  for (const item of data.items || []) {
    if (!categories.has(item.category)) {
      categories.add(item.category);
      testProducts.push(item);
    }
    if (testProducts.length >= 5) break;
  }
  for (const p of testProducts) {
    await t(`Product: ${p.category} "${p.title.slice(0, 40)}"`, 
      `http://localhost:3000/produkter/${p.slug}`,
      (b, s) => s === 200 && !b.includes("Server Error"));
  }

  console.log("\n=== SEARCH TESTS ===\n");
  
  // Fuzzy search
  const fuzzy = await fetch("http://localhost:3000/api/products?query=Mewtwo+Teamrocket&pageSize=5");
  const fuzzyData = await fuzzy.json();
  const fuzzyOk = fuzzyData.total > 0 && fuzzyData.items.some((i: { title: string }) => 
    i.title.toLowerCase().includes("mewtwo") && i.title.toLowerCase().includes("rocket"));
  console.log((fuzzyOk ? "PASS" : "FAIL") + ` Fuzzy "Mewtwo Teamrocket": ${fuzzyData.total} results`);
  fuzzyOk ? pass++ : fail++;

  // Exact search
  const exact = await fetch("http://localhost:3000/api/products?query=Charizard&pageSize=5");
  const exactData = await exact.json();
  const exactOk = exactData.total > 0;
  console.log((exactOk ? "PASS" : "FAIL") + ` Search "Charizard": ${exactData.total} results`);
  exactOk ? pass++ : fail++;

  console.log("\n=== SET FILTER TESTS ===\n");
  
  // Get Ascended Heroes set ID
  const setsRes = await fetch("http://localhost:3000/api/sets?pageSize=100");
  const setsData = await setsRes.json();
  const ascended = setsData.items?.find?.((s: { name: string }) => s.name === "Ascended Heroes");
  if (ascended) {
    const setRes = await fetch(`http://localhost:3000/api/products?setId=${ascended.id}&pageSize=5`);
    const setData = await setRes.json();
    const hasCards = setData.items?.some((i: { category: string }) => i.category === "SINGLE_CARD");
    const hasSealed = setData.items?.length > 0;
    console.log((setData.total > 10 ? "PASS" : "FAIL") + ` Ascended Heroes filter: ${setData.total} products`);
    console.log((hasCards ? "PASS" : "FAIL") + " Includes single cards");
    setData.total > 10 ? pass++ : fail++;
    hasCards ? pass++ : fail++;
  }

  // Test with the /produkter page directly (set filter via URL)
  if (ascended) {
    await t("Catalog with Ascended Heroes filter",
      `http://localhost:3000/produkter?set=${ascended.id}`,
      (b, s) => s === 200 && !b.includes("Inga produkter matchade"));
  }

  console.log("\n=== OFFERS TEST ===\n");
  // Frakt får vara null (okänd) — fabricerade fraktpriser är förbjudna.
  // Testa istället att offers finns och att prissatta offers har giltiga priser.
  const prodRes = await fetch("http://localhost:3000/api/products?query=Booster+Box&pageSize=1");
  const prodData = await prodRes.json();
  if (prodData.items?.length > 0) {
    const slug = prodData.items[0].slug;
    const offerRes = await fetch(`http://localhost:3000/api/products/${slug}/offers`);
    const offerData = await offerRes.json();
    const offers: { price: number | null; url: string }[] = offerData.offers ?? [];
    const hasOffers = offers.length > 0;
    const validPrices = offers.every((o) => o.price === null || o.price > 0);
    const validUrls = offers.every((o) => o.url?.startsWith("https://"));
    console.log((hasOffers ? "PASS" : "FAIL") + ` Product has offers (${slug}: ${offers.length})`);
    console.log((validPrices ? "PASS" : "FAIL") + " Priced offers have valid prices (null = link-offer OK)");
    console.log((validUrls ? "PASS" : "FAIL") + " All offers have https URLs");
    hasOffers ? pass++ : fail++;
    validPrices ? pass++ : fail++;
    validUrls ? pass++ : fail++;
  }

  console.log("\n=== SUMMARY ===");
  console.log(`${pass} passed, ${fail} failed`);
}

main().catch(console.error);

export {};
