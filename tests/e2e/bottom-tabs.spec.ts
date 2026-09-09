import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function openTabs(page: Page) {
  await page.goto("/mer");
  await page.waitForLoadState("networkidle");
  const cookieNotice = page.getByRole("button", { name: "Ok", exact: true });
  if (await cookieNotice.isVisible()) await cookieNotice.click();
  const nav = page.getByRole("navigation", { name: "Huvudnavigering", exact: true });
  await expect(nav).toBeVisible();
  const bounds = await nav.locator("ul").boundingBox();
  if (!bounds) throw new Error("Flikraden saknar mått");
  return { nav, bounds };
}

test("glid väljer först vid släpp, utan att öppna mellanliggande flikar", async ({ page, context }) => {
  const { nav, bounds } = await openTabs(page);
  const session = await context.newCDPSession(page);
  const y = bounds.y + bounds.height / 2;
  const x = (index: number) => bounds.x + bounds.width * (index + 0.5) / 5;
  const destinations: string[] = [];
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) destinations.push(frame.url()); });
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x(0), y }] });
  for (const index of [1, 2, 3]) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x(index), y }] });
  }
  await expect(page).toHaveURL(/\/mer$/);
  await expect(nav.locator('a[href$="/community"]')).toHaveClass(/text-holo-cyan/);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page).toHaveURL(/\/community$/);
  expect(destinations.every((url) => url.endsWith("/community"))).toBe(true);
  await session.detach();
  await nav.locator('a[href$="/mer"]').tap();
  await expect(page).toHaveURL(/\/mer$/);
});

test("släpp utanför och avbruten touch behåller sidan; tangentbord fungerar", async ({ page, context }) => {
  const { nav, bounds } = await openTabs(page);
  const session = await context.newCDPSession(page);
  const y = bounds.y + bounds.height / 2;
  for (const cancel of [false, true]) {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 350, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 270, y }] });
    if (!cancel) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 270, y: bounds.y - 70 }] });
    }
    await session.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
    await expect(page).toHaveURL(/\/mer$/);
    await expect(nav.locator('a[href$="/mer"]')).toHaveClass(/text-holo-cyan/);
  }
  await nav.locator('a[href$="/community"]').focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/community$/);
});

test("flikraden ryms på mobil och döljs på desktop", async ({ page }, testInfo) => {
  const { nav } = await openTabs(page);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const links = nav.locator("a");
    for (const link of await links.all()) {
      expect(await link.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const floating = await nav.boundingBox();
    expect(floating!.x).toBeGreaterThanOrEqual(18);
    expect(floating!.x + floating!.width).toBeLessThanOrEqual(width - 18);
    expect(844 - floating!.y - floating!.height).toBeGreaterThanOrEqual(8);
    await page.screenshot({ path: testInfo.outputPath(`tabs-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(nav).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("desktop.png") });
});

test("ändarna töjs med motstånd och fjädrar tillbaka utan sidbyte", async ({ page, context }, testInfo) => {
  const { nav } = await openTabs(page);
  const frame = (await nav.boundingBox())!;
  const surface = nav.locator("ul");
  const session = await context.newCDPSession(page);
  const y = frame.y + frame.height / 2;
  for (const side of [-1, 1]) {
    const start = side < 0 ? frame.x + frame.width / 10 : frame.x + frame.width * 0.9;
    const end = side < 0 ? frame.x - 8 : frame.x + frame.width + 8;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: end, y }] });
    await expect.poll(async () => (await surface.boundingBox())!.width).toBeGreaterThan(frame.width + 6);
    const stretched = (await surface.boundingBox())!;
    expect(stretched.x).toBeGreaterThan(0);
    expect(stretched.x + stretched.width).toBeLessThan(390);
    await page.screenshot({ path: testInfo.outputPath(`stretch-${side}.png`) });
    await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect.poll(async () => Math.abs((await surface.boundingBox())!.width - frame.width)).toBeLessThan(0.1);
    await expect(page).toHaveURL(/\/mer$/);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: frame.x + frame.width * 0.9, y }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: frame.x + frame.width + 8, y }] });
  expect((await surface.boundingBox())!.width).toBeCloseTo(frame.width, 1);
  await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
});
