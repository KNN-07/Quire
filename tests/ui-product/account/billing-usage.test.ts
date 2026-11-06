import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { connectionApplication } from "../../ui-integrations/application";
import { contextFor, responseData } from "../../ui-integrations/helpers";
import { startEditorBrowser, waitForRenderedText } from "../../ui-editor/shared/browser";
import { providerServer } from "../../adapters/ai/provider";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { endpoints } from "@quire/contracts";

test("actual billing browser shows actor receipts and selected project limits across reload at desktop and mobile widths", async () => {
  await using provider = providerServer();
  await using app = await connectionApplication({ http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
  const actor = await app.login();
  const operator = await app.login("operator@quire.local");
  const write = async (path: string, body: unknown, headers = actor.headers) => fetch(new URL(path, app.url), {
    method: "POST", headers: { ...headers, origin: app.url.origin, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const configured = await fetch(new URL("/api/admin/providers/ai", app.url), {
    method: "PUT", headers: { ...operator.headers, origin: app.url.origin, "content-type": "application/json", "if-match": '"0"' },
    body: JSON.stringify({ expectedVersion: 0, baseUrl: `${provider.origin}/v1`, model: "fixture-model",
      secret: "fixture-ai-key", policy: { ...defaultPolicy, ai: "agent", aiDailyUses: 7 } }),
  });
  expect(configured.status).toBe(200);
  const created = await write("/api/projects", { name: "Billing usage proof", origin: { kind: "blank" } });
  expect(created.status).toBe(200);
  const project = await responseData(created, endpoints.projectCreate.output);
  const { db, clock, events } = app.application.runtime;
  await db.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'project',?,?,?)",
    [crypto.randomUUID(), project.id, JSON.stringify({ ...defaultPolicy, ai: "agent" }), clock.now()]);
  await db.run("UPDATE organizations SET policy_json=? WHERE id IN (SELECT organization_id FROM members WHERE user_id=?)",
    [JSON.stringify({ ...defaultPolicy, ai: "agent" }), actor.user.id]);
  await db.run("INSERT INTO identity_ai_consent(user_id,terms_version,accepted,updated_at) VALUES(?,'2026-10-27',1,?)",
    [actor.user.id, clock.now()]);
  const completed = Promise.withResolvers<void>();
  const dispose = events.subscribe(event => {
    if (event.topic === "operation.changed" && ["succeeded", "failed"].includes(event.payload.status)) completed.resolve();
  });
  try {
    const run = await write(`/api/projects/${project.id}/ai/runs`, {
      scope: { projectId: project.id, branch: project.defaultBranch }, mode: "ask", tool: "chat", prompt: "Hello", fileIds: [],
    });
    expect(run.status).toBe(202);
    await completed.promise;
  } finally { dispose(); }
  expect(provider.received.length).toBe(1);
  await using browser = await startEditorBrowser();
  const context = await contextFor(browser.browser, { app, session: actor });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/settings/billing", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Usage", exact: true }).waitFor();
    await page.getByLabel("Project for applicable limits").selectOption(project.id);
    await waitForRenderedText(page, "1 of 7");
    await waitForRenderedText(page, "Unlimited");
    const evidence = resolve(import.meta.dir, "../../../docs/evidence/p73-billing-usage");
    await mkdir(evidence, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/usage-${width}.png`, fullPage: true });
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByLabel("Project for applicable limits").selectOption(project.id);
    await waitForRenderedText(page, "1 of 7");
    await db.run("UPDATE policy_sets SET policy_json=? WHERE scope_kind='project' AND scope_id=?",
      [JSON.stringify({ ...defaultPolicy, ai: "agent", aiDailyUses: 0, writableMembers: 0 }), project.id]);
    await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
    await waitForRenderedText(page, "1 of 0");
    await waitForRenderedText(page, "owner benefit limit: 0");
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}, 120_000);
