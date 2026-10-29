import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { endpoints, resultSchema, ProjectSchema, AiRunSchema } from "@quire/contracts";
import { SafeHttpClient } from "../../../../services/adapters/shared";
import { defaultPolicy } from "../../../../services/accounts/identity/policy";
import { providerServer } from "../../../adapters/ai/provider";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser, waitForRenderedText } from "../../../ui-editor/shared/browser";

test("mounted operator policy saves, reloads, rejects stale/nonoperator writes and enforces actual requests", async () => {
  const evidence = `docs/evidence/p28-ai-policy/browser-${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  let webOrigin = "";
  let apiOrigin = "";
  {
    await using provider = providerServer();
    const http = new SafeHttpClient({ fixtureOrigins: [provider.origin] });
    await using app = await connectionApplication({ http, ai: { http } });
    root = app.dataDir; webOrigin = app.url.origin; apiOrigin = app.apiUrl.origin;
    console.info("AI_POLICY_BROWSER_OWNED", { root, webOrigin, apiOrigin, provider: provider.origin, evidence });
    await using browser = await startEditorBrowser();
    await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    await using owner = await authenticatedContext(browser, app);
    const page = await operator.context.newPage();
    const stalePage = await operator.context.newPage();
    await page.goto("/admin/ai", { waitUntil: "domcontentloaded" });
    await page.getByLabel("API endpoint", { exact: true }).fill(`${provider.origin}/v1`);
    await page.getByLabel("Model", { exact: true }).fill("fixture-model");
    await page.getByLabel("API credential", { exact: true }).fill("fixture-ai-key");
    await page.getByRole("combobox", { name: "Allowed assistance" }).selectOption("agent");
    const connectionSaved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/providers/ai"
      && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Save configuration", exact: true }).click();
    expect((await connectionSaved).status()).toBe(200);
    await page.getByLabel("Replace API credential", { exact: true }).waitFor();
    expect(await page.getByLabel("Replace API credential", { exact: true }).inputValue()).toBe("");
    await stalePage.goto("/admin/ai", { waitUntil: "domcontentloaded" });
    await stalePage.getByRole("combobox", { name: "Request logging", exact: true }).waitFor();
    const logging = page.getByRole("combobox", { name: "Request logging", exact: true });
    const citation = page.getByRole("checkbox", { name: "Allow web search for citations", exact: true });
    const confidential = page.getByRole("checkbox", { name: "Block owner-tagged confidential projects", exact: true });
    await logging.selectOption("metadata");
    await citation.uncheck();
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.providerAiPolicyPut.path
      && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Save AI data policy", exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ data: {
      requestLogging: "metadata", citationWebSearch: false, blockConfidentialTags: true, version: 1,
    } });
    await waitForRenderedText(page, "Policy version 1");
    await page.reload({ waitUntil: "domcontentloaded" });
    await logging.waitFor();
    expect(await logging.inputValue()).toBe("metadata");
    expect(await citation.isChecked()).toBe(false);
    expect(await confidential.isChecked()).toBe(true);
    const stale = stalePage.waitForResponse(entry => new URL(entry.url()).pathname === endpoints.providerAiPolicyPut.path
      && entry.request().method() === "PUT");
    await stalePage.getByRole("button", { name: "Save AI data policy", exact: true }).click();
    expect((await stale).status()).toBe(409);
    await waitForRenderedText(stalePage, "AI policy changed");
    await stalePage.getByRole("button", { name: "Refresh AI data policy", exact: true }).click();
    await waitForRenderedText(stalePage, "Policy version 1");
    const memberDenied = await owner.context.request.put(endpoints.providerAiPolicyPut.path, {
      headers: { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken, "if-match": '"1"' },
      data: { requestLogging: "off", citationWebSearch: true, blockConfidentialTags: false, expectedVersion: 1 },
    });
    expect(memberDenied.status()).toBe(403);

    const created = await owner.context.request.post(endpoints.projectCreate.path, {
      headers: { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken, "idempotency-key": crypto.randomUUID() },
      data: { name: "AI policy browser fixture", origin: { kind: "blank" } },
    });
    expect(created.status()).toBe(200);
    const project = z.object({ data: ProjectSchema }).parse(await created.json()).data;
    const db = app.application.runtime.db;
    const actor = project.ownerId;
    await db.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'project',?,?,?)",
      [crypto.randomUUID(), project.id, JSON.stringify({ ...defaultPolicy, ai: "agent" }), app.application.runtime.clock.now()]);
    await db.run("UPDATE organizations SET policy_json=? WHERE id IN (SELECT organization_id FROM members WHERE user_id=?)",
      [JSON.stringify({ ...defaultPolicy, ai: "agent" }), actor]);
    await db.run("INSERT INTO identity_ai_consent(user_id,terms_version,accepted,updated_at) VALUES(?,'2026-10-27',1,?)",
      [actor, app.application.runtime.clock.now()]);
    const runPath = `/api/projects/${project.id}/ai/runs`;
    const request = { scope: { projectId: project.id, branch: project.defaultBranch },
      mode: "ask", tool: "citation-reviewer", prompt: "private-browser-canary", fileIds: [] };
    const send = (tool: string) => owner.context.request.post(runPath, {
      headers: { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken, "idempotency-key": crypto.randomUUID() }, data: { ...request, tool },
    });
    const deniedCitation = await send("citation-reviewer");
    expect(deniedCitation.status()).toBe(403);
    expect(await deniedCitation.json()).toMatchObject({ error: { code: "AI_CITATION_POLICY_DENIED" } });
    expect(provider.received).toHaveLength(0);
    const done = Promise.withResolvers<void>();
    const deadline = setTimeout(() => done.reject(new Error("AI terminal event missing")), 15_000);
    const unsubscribe = app.application.runtime.events.subscribe(event => {
      if (event.topic === "operation.changed" && event.payload.status === "succeeded") done.resolve();
    });
    try {
      const dispatched = await send("chat");
      expect(dispatched.status()).toBe(202);
      const run = z.object({ data: AiRunSchema }).parse(await dispatched.json()).data;
      await done.promise;
      expect(await db.get("SELECT status,encrypted_content FROM ai_request_logs WHERE run_id=?", [run.id]))
        .toEqual({ status: "succeeded", encrypted_content: null });
    } finally { clearTimeout(deadline); unsubscribe(); }
    const security = await owner.context.request.put(`/api/projects/${project.id}/ai/security`, {
      headers: { origin: app.url.origin, "x-csrf-token": owner.session.csrfToken }, data: { confidential: true, expectedVersion: 0 },
    });
    expect(security.status()).toBe(200);
    await confidential.uncheck();
    const lessRestricted = page.waitForResponse(entry => new URL(entry.url()).pathname === endpoints.providerAiPolicyPut.path
      && entry.request().method() === "PUT");
    await page.getByRole("button", { name: "Save AI data policy", exact: true }).click();
    expect((await lessRestricted).status()).toBe(200);
    await waitForRenderedText(page, "Policy version 2");
    const deniedConfidential = await send("chat");
    expect(deniedConfidential.status()).toBe(403);
    expect(await deniedConfidential.json()).toMatchObject({ error: { code: "AI_CONFIDENTIAL" } });
    expect(provider.received).toHaveLength(1);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(() => document.fonts.ready);
        const form = page.getByRole("form", { name: "AI data policy", exact: true });
        await form.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await logging.evaluate(element => {
          const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth;
        })).toBe(true);
        await page.screenshot({ path: `${evidence}/${width}-${colorScheme}.png`, fullPage: true });
      }
    }
    const final = resultSchema(endpoints.providerAiPolicyGet.output).parse(
      await (await operator.context.request.get(endpoints.providerAiPolicyGet.path)).json());
    expect(final).toMatchObject({ data: { version: 2, blockConfidentialTags: false } });
    console.info("AI_POLICY_BROWSER_VERIFIED", { version: 2, staleStatus: 409, nonoperatorStatus: 403,
      citationStatus: deniedCitation.status(), confidentialStatus: deniedConfidential.status(), controlledDispatches: provider.received.length, evidence });
    await stalePage.close(); await page.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  for (const origin of [webOrigin, apiOrigin]) await rejects(fetch(origin, { signal: AbortSignal.timeout(5_000) }));
  console.info("AI_POLICY_BROWSER_CLEANED", { root, webOrigin, apiOrigin, evidence });
}, 180_000);
