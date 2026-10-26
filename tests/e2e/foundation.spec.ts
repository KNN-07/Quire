import { test, expect } from "@playwright/test";

test("shell reports the real API health when loaded", async ({ page }) => {
  // Given: the isolated development servers started by the harness.
  // When: a browser loads the shell.
  await page.goto("/");
  // Then: the mounted app has contacted its API through the Vite proxy.
  await expect(page.getByRole("heading", { name: "Quire workspace" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("API connected");
});
