import { expect, test } from "bun:test";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { baseFixture } from "../../core/base/harness";
import { startEditorBrowser } from "./browser";

test("repeated browser process teardown preserves live file, SQL and Git descriptors", async () => {
  // Given: the actual native application and many live file descriptions.
  await using app = await baseFixture();
  const owner = await app.login();
  const handles = await Promise.all(Array.from({ length: 32 }, (_, index) =>
    open(join(app.path, `browser-fd-${index}`), "w+")));
  try {
    // When: independently owned Chromium hosts launch, render and terminate.
    for (let wave = 0; wave < 4; wave++) {
      {
        await using browser = await startEditorBrowser();
        const context = await browser.browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto("data:text/html,<title>Descriptor lifecycle</title><main>Rendered</main>");
          expect(await page.title()).toBe("Descriptor lifecycle");
        } finally { await context.close(); }
      }
      Bun.gc(true);
      // Then: all held descriptors and actual persisted source publication still work.
      const states = await Promise.all(handles.map(handle => handle.stat()));
      expect(states.every(state => state.isFile())).toBe(true);
      const project = await app.create(owner.headers, `Browser wave ${wave}`);
      expect((await app.service.readDocument({ projectId: project.id, branch: "main" },
        project.settings.mainFileId)).text).toContain("\\documentclass");
    }
  } finally { await Promise.all(handles.map(handle => handle.close())); }
}, 120000);
