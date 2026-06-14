/**
 * Quick site test: check all critical pages and features
 */
async function testUrl(url: string, expect: number = 200): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    const ok = res.status === expect;
    console.log((ok ? "OK" : "FAIL") + " " + res.status + " " + url);
    return ok;
  } catch (e) {
    console.log("ERR " + url + ": " + (e as Error).message?.slice(0, 60));
    return false;
  }
}

async function main() {
  let failures = 0;
  const check = async (url: string, expect = 200) => {
    if (!(await testUrl(url, expect))) failures++;
  };

  console.log("=== TESTING PAGES ===\n");
  
  // Core pages
  await check("http://localhost:3000/");
  await check("http://localhost:3000/produkter");
  await check("http://localhost:3000/sets");
  await check("http://localhost:3000/marknad");
  await check("http://localhost:3000/logga-in");
  await check("http://localhost:3000/priser");
  await check("http://localhost:3000/community");
  await check("http://localhost:3000/sitemap.xml");
  
  // Dashboard should redirect to login
  await check("http://localhost:3000/dashboard", 307);
  
  // Product detail pages - test a few
  console.log("\n=== PRODUCT PAGES ===\n");
  const productRes = await fetch("http://localhost:3000/api/products?pageSize=5");
  const productData = await productRes.json();
  if (productData.items) {
    for (const item of productData.items.slice(0, 3)) {
      await check("http://localhost:3000/produkter/" + item.slug);
    }
  }

  // Test search API
  console.log("\n=== SEARCH API ===\n");
  
  // Fuzzy search test
  const fuzzyRes = await fetch("http://localhost:3000/api/products?q=Mewtwo+Teamrocket");
  const fuzzyData = await fuzzyRes.json();
  console.log("Search 'Mewtwo Teamrocket': " + (fuzzyData.total || 0) + " results");
  if (fuzzyData.items?.length > 0) {
    console.log("  First: " + fuzzyData.items[0].title.slice(0, 60));
  }

  // Set filter test - Ascended Heroes
  const setsRes = await fetch("http://localhost:3000/api/sets");
  const setsData = await setsRes.json();
  const ascended = setsData.find?.((s: { name: string }) => s.name === "Ascended Heroes");
  if (ascended) {
    const setFilterRes = await fetch("http://localhost:3000/api/products?setId=" + ascended.id + "&pageSize=10");
    const setFilterData = await setFilterRes.json();
    console.log("Set filter 'Ascended Heroes': " + (setFilterData.total || 0) + " results");
    if (setFilterData.items?.length > 0) {
      const categories = [...new Set(setFilterData.items.map((i: { category: string }) => i.category))];
      console.log("  Categories found: " + categories.join(", "));
    }
  } else {
    console.log("Could not find Ascended Heroes set in API");
  }

  console.log("\n=== SUMMARY ===");
  console.log(failures === 0 ? "All checks passed!" : failures + " failures");
}

main().catch(console.error);

export {};
