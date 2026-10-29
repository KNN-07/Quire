import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints, parseResourceVersionTag, resultSchema } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { surfaceSignal, openSurface } from "../assembly/actual-browser";
import { nextApplicationEvent, projectDocument, waitForRenderedText } from "../shared";
import { consent, diagnosticFixture, projectPath, scope } from "../diagnostic-ai/fixture";

test("review thread opens an inert consented snapshot and rejects a changed thread before dispatch", async () => {
  await using setup = await diagnosticFixture();
  const { page, provider, context, owner } = setup;
  const initial = await projectDocument(context, scope);
  await openSurface(page, { path: `${projectPath}/review`, selector: ".quire-thread-list, #threads-title" });
  const body = "Explain the stability assumption in the introduction.";
  await page.getByLabel("Project comment", { exact: true }).fill(body);
  const createdResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api${projectPath}/threads` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const created = editorValue(resultSchema(endpoints.threadCreate.output).parse(await (await createdResponse).json()));
  const thread = page.locator(".quire-thread").filter({ hasText: body });
  await thread.getByRole("button", { name: "Ask Assistant about thread" }).click();
  await page.getByRole("region", { name: "Selected review thread" }).waitFor();
  const threadConsent = page.getByLabel("Send this review thread snapshot to the configured provider");
  expect(await threadConsent.isChecked()).toBe(false);
  expect(await page.getByRole("button", { name: "Ask", exact: true }).getAttribute("aria-pressed")).toBe("true");
  expect(provider.received).toHaveLength(0);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(page, "Consent to the displayed review thread");
  expect(provider.received).toHaveLength(0);
  await threadConsent.check();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(page, "AI_CONSENT_REQUIRED");
  expect(provider.received).toHaveLength(0);
  await consent(page);
  const current = await owner.http.get(`api/projects/${scope.projectId}/threads/${created.id}`, { searchParams: { branch: scope.branch } });
  const version = parseResourceVersionTag(current.headers.get("etag"));
  if (version === null) throw new TypeError("Thread version required");
  const replyBody = "Please include the boundary conditions.";
  const replied = await owner.http.post(`api/projects/${scope.projectId}/threads/${created.id}/replies`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    json: { body: replyBody, expectedVersion: version },
  });
  expect(replied.ok).toBe(true);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRenderedText(page, "Review thread changed");
  expect(provider.received).toHaveLength(0);
  await page.getByRole("button", { name: "Clear review thread context" }).click();
  await openSurface(page, { path: `${projectPath}/review`, selector: ".quire-thread" });
  await page.locator(".quire-thread").filter({ hasText: body }).getByRole("button", { name: "Ask Assistant about thread" }).click();
  await page.getByRole("region", { name: "Selected review thread" }).waitFor();
  expect(await threadConsent.isChecked()).toBe(false);
  await threadConsent.check();
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
    await threadConsent.evaluate(element => element.scrollIntoView({ block: "center" }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${setup.evidence}/review-thread-${width}-${theme}.png` });
  }
  provider.respond({ text: "Review the assumptions and boundary conditions.", patches: [], citations: [] });
  using finished = nextApplicationEvent(setup.app, event => event.topic === "operation.changed"
    && event.payload.status === "succeeded");
  const completed = await surfaceSignal(page, ".qa-assistant__run");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await finished.promise;
  await completed.observed;
  await waitForRenderedText(page, "Ask run");
  expect(provider.contexts).toHaveLength(1);
  const sent = z.object({ reviewThread: z.object({ id: z.string(), version: z.number(),
    comments: z.array(z.object({ body: z.string() })) }) }).parse(JSON.parse(provider.contexts[0]?.prompt ?? ""));
  expect(sent.reviewThread.id).toBe(created.id);
  expect(sent.reviewThread.version).toBeGreaterThan(version);
  expect(sent.reviewThread.comments.map(comment => comment.body)).toEqual([body, replyBody]);
  expect(provider.contexts[0]?.files).toEqual([]);
  expect((await projectDocument(context, scope)).text).toBe(initial.text);
  expect(setup.errors).toEqual([]);
}, 180_000);
