import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE = resolve(import.meta.dirname, "../public/samples/sample4.webp");
const VISITOR_PHOTO = resolve(import.meta.dirname, "../public/samples/sample2.webp");

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("LogEarlyWarning")
    ) {
      errors.push(message.text());
    }
  });
  return errors;
}

async function serveCommonsLocally(page: Page): Promise<void> {
  await page.route("https://upload.wikimedia.org/**", (route) =>
    route.fulfill({
      path: FIXTURE,
      contentType: "image/webp",
      headers: { "access-control-allow-origin": "*" },
    }),
  );
}

const headline = (page: Page) => page.getByRole("heading", { level: 1 });

test("lays crooked photos on the desk and straightens all of them", async ({ page }) => {
  const errors = watchErrors(page);
  await serveCommonsLocally(page);
  await page.goto("/?seed=7&limit=24&workers=2&intro=off");
  await expect(headline(page)).toHaveAccessibleName(/向きがばらばらの写真/);
  await expect(headline(page)).toHaveAccessibleName(/並べ終えた写真\s*24枚/, {
    timeout: 150_000,
  });
  await expect(page.locator(".ruler")).toContainText("判定");
  await page.getByRole("button", { name: "一覧", exact: true }).click();
  const rows = page.locator(".ledger-table tbody tr");
  await expect(rows).toHaveCount(24);
  await expect(rows.filter({ hasText: "サンプル写真" })).toHaveCount(4);
  const desk = await page.locator("canvas.desk-canvas").screenshot();
  expect(desk.byteLength).toBeGreaterThan(40_000);
  await page.screenshot({ path: "test-results/desk-finished.png" });
  expect(errors).toEqual([]);
});

test("puts a visitor's photo on the desk without uploading it", async ({ page }) => {
  const errors = watchErrors(page);
  await serveCommonsLocally(page);
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") {
      uploads.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.goto("/?seed=3&limit=6&workers=2&intro=off");
  await page.locator('input[type="file"]').setInputFiles(VISITOR_PHOTO);
  await expect(headline(page)).toHaveAccessibleName(/並べ終えた写真/, {
    timeout: 150_000,
  });
  await page.getByRole("button", { name: "一覧", exact: true }).click();
  const row = page.locator(".ledger-table tbody tr", { hasText: "sample2.webp" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("あなたの写真");
  expect(uploads).toEqual([]);
  expect(errors).toEqual([]);
});

test("keeps judging photos when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === "webgl2" || type === "webgl") {
          return null;
        }
        return Reflect.apply(original, this, [type, ...rest]);
      },
    });
  });
  await serveCommonsLocally(page);
  await page.goto("/?seed=5&limit=8&workers=2&intro=off");
  await expect(page.locator(".flat-message")).toBeVisible();
  await expect(headline(page)).toHaveAccessibleName(/並べ終えた写真/, {
    timeout: 150_000,
  });
  await page.getByRole("button", { name: "一覧を開く" }).click();
  await expect(page.locator(".ledger-table tbody tr")).toHaveCount(8);
});

test("explains when Wikimedia Commons cannot be reached", async ({ page }) => {
  await page.route("https://upload.wikimedia.org/**", (route) => route.abort());
  await page.goto("/?seed=7&limit=12&workers=2&intro=off");
  await expect(page.locator(".ruler-notice")).toContainText(
    "Wikimedia Commons に接続できませんでした",
    { timeout: 90_000 },
  );
  await page.getByRole("button", { name: "一覧", exact: true }).click();
  await expect(
    page.locator(".ledger-table tbody tr", { hasText: "サンプル写真" }),
  ).toHaveCount(3, { timeout: 90_000 });
});
