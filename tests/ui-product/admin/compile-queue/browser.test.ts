import { expect, test } from "bun:test";
import { mkdir, stat } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { endpoints, IdSchema, resultSchema } from "@quire/contracts";
import { fixtureIds } from "../../../fixtures/foundation";
import { connectionApplication } from "../../../ui-integrations/application";
import { authenticatedContext, startEditorBrowser } from "../../../ui-editor/shared/browser";

test("operator queue reads real persisted job metadata and links to worker administration", async () => {
  const evidence = `docs/evidence/p35-compile-queue/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  let root = "";
  {
    await using app = await connectionApplication();
    root = app.dataDir;
    const runtime = app.application.runtime;
    const project = await runtime.db.get<{ settings_json: string }>("SELECT settings_json FROM projects WHERE id=?", [fixtureIds.project]);
    if (!project) throw new TypeError("Seed project required");
    const queued = IdSchema.parse(crypto.randomUUID());
    const running = IdSchema.parse(crypto.randomUUID());
    const completed = IdSchema.parse(crypto.randomUUID());
    const queuedAt = runtime.clock.now();
    await runtime.uow.run(async tx => {
      for (const [id, status] of [[queued, "queued"], [running, "running"], [completed, "succeeded"]] as const) {
        await tx.run(`INSERT INTO compile_jobs(id,actor_id,snapshot_id,environment_id,settings_json,status,
          queued_at,started_at,idempotency_key,queue_order)
          VALUES(?,?,?,?,?,?,?,?,?,(SELECT coalesce(MAX(queue_order),0)+1 FROM compile_jobs))`,
        [id, fixtureIds.kien, fixtureIds.snapshot, fixtureIds.environment, project.settings_json, status,
          queuedAt, status === "running" ? queuedAt : null, crypto.randomUUID()]);
      }
    });
    console.info("COMPILE_QUEUE_OWNED", { root, web: app.url.origin, api: app.apiUrl.origin, evidence, queued, running, completed });
    await using browser = await startEditorBrowser();
    await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    await using member = await authenticatedContext(browser, app);
    expect((await fetch(new URL("/api/admin/compile-queue", app.url), { signal: AbortSignal.timeout(10_000) })).status).toBe(401);
    expect((await member.context.request.get("/api/admin/compile-queue")).status()).toBe(403);
    const first = await operator.context.request.get("/api/admin/compile-queue?limit=1");
    expect(first.headers()["cache-control"]).toBe("private, no-store");
    const firstResult = resultSchema(endpoints.adminCompileQueue.output).parse(await first.json());
    if (!("data" in firstResult)) throw new TypeError(firstResult.error.code);
    const expected = [queued, running].sort();
    const firstExpected = expected[0];
    if (!firstExpected) throw new TypeError("Queue fixture requires an active job");
    expect(firstResult.data.items.map(item => item.id)).toEqual(expected.slice(0, 1));
    expect(firstResult.data.nextCursor).toBe(firstExpected);
    const next = await operator.context.request.get("/api/admin/compile-queue", { params: { limit: 1, cursor: firstResult.data.nextCursor ?? "" } });
    const nextResult = resultSchema(endpoints.adminCompileQueue.output).parse(await next.json());
    if (!("data" in nextResult)) throw new TypeError(nextResult.error.code);
    expect(nextResult.data.items.map(item => item.id)).toEqual(expected.slice(1));
    expect(nextResult.data.nextCursor).toBeNull();
    expect((await operator.context.request.get("/api/admin/compile-queue", { params: { cursor: crypto.randomUUID() } })).status()).toBe(400);
    const page = await operator.context.newPage();
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.adminCompileQueue.path);
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    expect((await loaded).status()).toBe(200);
    const queue = page.getByRole("region", { name: "Compile queue", exact: true });
    await queue.locator("tbody tr").first().waitFor();
    expect(await queue.locator("tbody tr").count()).toBe(2);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await queue.evaluate(element => element.scrollIntoView({ block: "center" }));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/${width}-${colorScheme}.png` });
      }
    }
    await runtime.db.run("UPDATE compile_jobs SET status='succeeded' WHERE id=?", [running]);
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === endpoints.adminCompileQueue.path);
    await queue.getByRole("button", { name: "Refresh queue", exact: true }).click();
    await refreshed;
    await queue.getByText("queued", { exact: true }).waitFor();
    expect(await queue.locator("tbody tr").count()).toBe(1);
    await queue.getByRole("button", { name: "Add worker", exact: true }).click();
    await page.getByRole("heading", { name: "Compile workers", exact: true }).waitFor();
    expect(new URL(page.url()).pathname).toBe("/admin/workers");
    await page.close();
  }
  await rejects(stat(root), { code: "ENOENT" });
  console.info("COMPILE_QUEUE_CLOSED", { root, evidence });
}, 180_000);
