import { chromium } from "@playwright/test";

const shots = process.argv[2];
const origin = process.env.OVERLAY_ORIGIN ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"],
});
const errors = [];

async function desk(width, height, query, extra = {}) {
  const context = await browser.newContext({ viewport: { width, height }, ...extra });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/${query}`);
  return { context, page };
}

{
  const { context, page } = await desk(1440, 900, "?intro=off&seed=7");
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${shots}/desk-1440.png` });
  await page.getByRole("button", { name: "一覧", exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator(".ledger-photo").nth(1).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${shots}/list-pinned-1440.png` });
  console.log("live", await page.evaluate(() => document.querySelector(".overlay > [aria-live]")?.textContent));
  await context.close();
}
{
  const { context, page } = await desk(1280, 720, "?intro=off&seed=7");
  await page.waitForTimeout(6000);
  await page.getByRole("button", { name: "一覧", exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator(".ledger-photo").nth(0).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${shots}/list-pinned-1280.png` });
  await context.close();
}
{
  const { context, page } = await desk(1440, 900, "?seed=7");
  await page.waitForFunction(() => document.querySelector(".overlay")?.hasAttribute("data-intro"));
  await page.waitForFunction(() => !document.querySelector(".overlay")?.hasAttribute("data-intro"), null, { timeout: 30000 });
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${shots}/handoff-0450.png` });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${shots}/handoff-1750.png` });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shots}/handoff-3250.png` });
  await context.close();
}
{
  const { context, page } = await desk(390, 844, "?intro=off&seed=7", { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${shots}/mobile-early.png` });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${shots}/mobile-folded.png` });
  await page.getByRole("button", { name: "設定" }).tap();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/mobile-settings.png` });
  await page.getByRole("button", { name: "一覧", exact: true }).tap();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}/mobile-list.png` });
  await context.close();
}
{
  const { context, page } = await desk(720, 450, "?intro=off&seed=7");
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${shots}/zoom-720x450.png` });
  await page.getByRole("radio", { name: /軽量/ }).focus();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/zoom-720x450-focus.png` });
  await context.close();
}
console.log("errors", JSON.stringify(errors));
await browser.close();
