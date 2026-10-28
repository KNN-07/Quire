import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { authenticatedContext, startEditorApplication, startEditorBrowser } from "../shared";
import { firstProject, mountGit, prepareTwoHunks } from "./setup";

test("T20 Git workspace holds desktop and mobile layouts in both themes", async () => {
  // Given: the real populated Git workspace.
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using actor = await authenticatedContext(browser, app, { viewport: { width: 1440, height: 900 } });
  const project = await firstProject(actor.context);
  await prepareTwoHunks(app, actor, project);
  const page = await actor.context.newPage();
  await mountGit(page, project.id);
  const cases = [
    { width: 1440, height: 900, theme: "light" },
    { width: 1440, height: 900, theme: "dark" },
    { width: 390, height: 844, theme: "light" },
    { width: 390, height: 844, theme: "dark" },
  ] as const;
  for (const item of cases) {
    // When: each required viewport and theme is rendered from the current build.
    await page.setViewportSize({ width: item.width, height: item.height });
    await page.evaluate(theme => { document.documentElement.dataset["theme"] = theme; }, item.theme);
    if (item.width === 390) await page.getByRole("button", { name: "Diff", exact: true }).click();
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth > innerWidth,
      workspace: document.querySelector(".git-workspace")?.scrollWidth
        !== document.querySelector(".git-workspace")?.clientWidth,
    }));
    // Then: primary content has one readable column at mobile and no viewport overflow.
    expect(overflow).toEqual({ document: false, workspace: false });
    expect(await page.locator(".git-workspace").count()).toBe(1);
    expect(await page.locator(".git-hunk").count()).toBe(2);
    await page.screenshot({
      path: fileURLToPath(new URL(
        `./evidence/git-${item.width}-${item.theme}.png`,
        import.meta.url,
      )),
    });
  }
}, 180_000);
