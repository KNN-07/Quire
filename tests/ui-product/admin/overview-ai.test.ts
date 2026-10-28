import { expect, spyOn, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { SecretBox } from "../../../services/adapters/shared/secrets";
import { authenticatedContext, startEditorApplication, startEditorBrowser, waitForRenderedText } from "../../ui-editor/shared";

test("administration renders actual AI configuration states at desktop and narrow widths", async () => {
  await using app = await startEditorApplication();
  await using browser = await startEditorBrowser();
  await using operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
  const ai = app.application.adapters?.ai.service;
  if (!ai) throw new Error("Actual governed AI service required");
  const request = spyOn(ai.store.services.http, "request");
  const page = await operator.context.newPage();
  const evidence = `docs/evidence/p9-overview-ai/${crypto.randomUUID()}`;
  await mkdir(evidence, { recursive: true });
  console.info("OVERVIEW_AI_OWNED", { root: app.dataDir, web: app.url.origin, evidence });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const renderedState = (state: string) => page.evaluate(expected => new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(check);
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`AI overview state not rendered: ${expected}`));
    }, 30_000);
    function check() {
      const rows = document.querySelectorAll('section[aria-labelledby="admin-capability-heading"] tbody tr');
      const row = [...rows].find(value => value.querySelector('[data-label="Capability"]')?.textContent === "ai");
      if (!row?.querySelector('[data-label="Status"]')?.textContent?.startsWith(expected)) return;
      observer.disconnect(); clearTimeout(timer); resolve();
    }
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    check();
  }), state);
  const capture = async (state: string) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
        await page.getByRole("region", { name: "Configured capabilities" }).scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `${evidence}/${state}-${width}-${theme}.png` });
      }
    }
  };
  const refresh = async (state: string) => {
    const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/admin/overview");
    await page.getByRole("button", { name: "Refresh overview", exact: true }).click();
    expect((await response).status()).toBe(200);
    await renderedState(state);
  };
  try {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await waitForRenderedText(page, "Configured capabilities");
    await renderedState("unconfigured");
    await capture("unconfigured");
    // Provision the real encrypted fixture row; no capability response is stubbed.
    const provider = await ai.store.services.configuration.get("ai");
    const secret = new SecretBox(app.application.runtime.secretKey).seal("overview-fixture-credential", "provider:ai");
    await app.application.runtime.db.run(`INSERT INTO adapter_provider_configs
      (id,kind,base_url,model,encrypted_secret,policy_json,enabled,version,updated_at)
      VALUES(?,'ai','https://provider.invalid/v1','fixture-model',?,?,1,1,?)`,
    [provider.id, secret, JSON.stringify(defaultPolicy), app.application.runtime.clock.now()]);
    await refresh("ready");
    await capture("ready");
    await app.application.runtime.db.run("UPDATE adapter_provider_configs SET enabled=0,version=version+1 WHERE kind='ai'");
    await refresh("disabled");
    await capture("disabled");
    expect(request).not.toHaveBeenCalled();
    expect(await page.locator("body").innerText()).not.toContain("overview-fixture-credential");
    expect(errors).toEqual([]);
  } finally {
    request.mockRestore();
  }
  console.info("OVERVIEW_AI_COMPLETE", { root: app.dataDir, evidence });
}, 180_000);
