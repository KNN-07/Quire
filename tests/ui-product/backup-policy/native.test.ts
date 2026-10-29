import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { runScheduledBackup } from "../../../services/operations/backups";
import { authenticateApi, startEditorApplication, startEditorBrowser } from "../../ui-editor/shared";
import { openSurface } from "../../ui-editor/assembly/actual-browser";

test("native backup policy saves manual and UTC schedules with real operator-owned deduplication", async () => {
  const evidence = `docs/evidence/p65-backup-policy/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root: string;
  {
    await using app = await startEditorApplication();
    await using browser = await startEditorBrowser();
    root = app.dataDir;
    const actor = await authenticateApi(app, "operator@quire.local");
    const context = await browser.browser.newContext({ baseURL: app.url.origin });
    const runtime = app.application.runtime;
    const scheduler = { ...runtime, routes: runtime.routes.forLane("O") };
    console.info("P65_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence, runtime: Bun.version });
    try {
      await context.addCookies([actor.cookie]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await openSurface(page, { path: "/admin/storage", selector: ".admin-policy form" });
      const destination = page.getByLabel("Destination", { exact: true });
      expect(await destination.isEditable()).toBe(false);
      const fixedRoot = await destination.inputValue();
      const schedule = page.getByLabel("Schedule (cron)", { exact: true });
      const retention = page.getByLabel("Retention (days)", { exact: true });
      expect(await schedule.inputValue()).toBe("");
      for (const invalid of ["0", "36501", "1.5"]) {
        await retention.fill(invalid);
        expect(await retention.evaluate(node => node instanceof HTMLInputElement && node.checkValidity())).toBe(false);
      }
      await retention.fill("1");
      const save = async () => {
        const response = page.waitForResponse(entry => entry.request().method() === "PUT"
          && new URL(entry.url()).pathname === endpoints.backupPolicyPut.path);
        await page.getByRole("button", { name: "Save policy", exact: true }).click();
        const saved = await response;
        expect(saved.status()).toBe(200);
        return editorValue(resultSchema(endpoints.backupPolicyPut.output).parse(await saved.json()));
      };
      await schedule.fill("  ");
      const manual = await save();
      const readPolicy = async () => editorValue(resultSchema(endpoints.backupPolicyGet.output).parse(
        await (await actor.http.get("api/admin/backups/policy")).json()));
      expect(await readPolicy()).toMatchObject({ schedule: "disabled", retentionDays: 1, destination: fixedRoot, version: manual.version });
      expect(await runScheduledBackup(scheduler, actor.user.id)).toBeNull();
      await openSurface(page, { path: "/admin/storage", selector: ".admin-policy form" });
      expect(await schedule.inputValue()).toBe("");
      expect(await retention.inputValue()).toBe("1");
      await schedule.fill("0 3 * * *");
      const daily = await save();
      const policy = await readPolicy();
      expect(policy).toMatchObject({ schedule: "0 3 * * *", destination: fixedRoot, version: daily.version });
      expect(await runtime.db.all("SELECT id FROM backups")).toHaveLength(0);
      for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme });
        await page.locator(".admin-policy").scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `${evidence}/policy-${width}-${colorScheme}.png`, fullPage: true });
      }
      // This is the operator timer's real entrypoint, not an invented in-process timer.
      const first = await runScheduledBackup(scheduler, actor.user.id);
      const duplicate = await runScheduledBackup(scheduler, actor.user.id);
      expect(first?.status).toBe("succeeded");
      expect(duplicate?.id).toBe(first?.id);
      const backups = await runtime.db.all("SELECT id,status,verified_at FROM backups");
      expect(backups).toHaveLength(1);
      expect(backups[0]?.["verified_at"]).not.toBeNull();
      await runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [actor.user.id]);
      await rejects(runScheduledBackup(scheduler, actor.user.id), { code: "FORBIDDEN" });
      expect(await runtime.db.all("SELECT id FROM backups")).toHaveLength(1);
      expect(errors).toEqual([]);
      await Bun.write(`${evidence}/receipt.json`, JSON.stringify({
        utc: new Date().toISOString(), root, origins: [app.url.origin, app.apiUrl.origin],
        manual, policy, first, duplicate, backups, errors,
      }, null, 2));
    } finally { await context.close(); }
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("P65_CLEANUP", { root, absent: true, utc: new Date().toISOString() });
}, 240_000);
