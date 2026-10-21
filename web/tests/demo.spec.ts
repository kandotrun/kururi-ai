import { expect, test } from "@playwright/test";

test("loads the nano model and corrects sample photos", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("LogEarlyWarning")
    ) {
      errors.push(message.text());
    }
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /大量の写真/ })).toBeVisible();
  await expect(page.locator("#model-status")).toContainText("準備完了", {
    timeout: 120_000,
  });
  await page.getByRole("button", { name: "サンプルで試す" }).click();
  await expect(page.locator("#count-ready")).toHaveText("5", {
    timeout: 180_000,
  });
  await expect(page.locator(".photo-card[data-state='done']")).toHaveCount(5);
  await expect(page.locator("#median-time")).not.toHaveText("—");
  await expect(page.getByRole("button", { name: "クリア" })).toBeEnabled();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "test-results/demo-contact-sheet.png",
    fullPage: true,
  });
});
