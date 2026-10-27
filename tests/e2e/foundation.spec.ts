import { test, expect } from "@playwright/test";

test("application mounts the real marketing and account pages", async ({ page }) => {
  // Given: the isolated development servers started by the harness.
  // When: a browser opens the product entry.
  await page.goto("/");
  // Then: the landing page leads to the implemented local authentication page.
  await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});
