import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Request } from "@playwright/test";
import { fixtureIds } from "../../fixtures/foundation";
import {
  authenticatedContext,
  startEditorApplication,
  startEditorBrowser,
} from "../shared";
import type { EditorApplication, EditorBrowser } from "../shared";
import { openSurface, surfaceSignal } from "../assembly/actual-browser";

const evidence = process.env["QUIRE_AUTHORITY_TRAFFIC_EVIDENCE"]
  ?? fileURLToPath(new URL("../../../docs/evidence/p2u/authority-traffic.json", import.meta.url));

type Traffic = {
  readonly route: string;
  readonly baseline: Readonly<Record<string, number>>;
  readonly limited: Readonly<Record<string, number>>;
  readonly restored: Readonly<Record<string, number>>;
  readonly requests: readonly string[];
};

function requestKey(request: Request) {
  const url = new URL(request.url());
  if (url.pathname === "/api/events") return `events?after=${url.searchParams.get("after")}`;
  if (url.pathname.endsWith("/effective-access")) return "effective-access";
  if (url.pathname.endsWith("/threads")) return "threads";
  if (url.pathname.endsWith("/suggestions")) return "suggestions";
  if (url.pathname.endsWith("/history")) return "history";
  if (url.pathname.endsWith("/chat")) return "chat";
  return "";
}

function count(requests: readonly string[]) {
  const result: Record<string, number> = {};
  for (const request of requests) if (request) result[request] = (result[request] ?? 0) + 1;
  return result;
}

describe("authority refresh review subscription traffic", () => {
  const resources = new AsyncDisposableStack();
  const observations: Traffic[] = [];
  let app: EditorApplication;
  let browser: EditorBrowser;
  let editor: Awaited<ReturnType<typeof authenticatedContext>>;
  let operator: Awaited<ReturnType<typeof authenticatedContext>>;
  let grantVersion = 0;

  beforeAll(async () => {
    await mkdir(fileURLToPath(new URL("../../../docs/evidence/p2u/", import.meta.url)), { recursive: true });
    app = await startEditorApplication();
    resources.defer(() => app[Symbol.asyncDispose]());
    browser = await startEditorBrowser();
    resources.defer(() => browser[Symbol.asyncDispose]());
    editor = await authenticatedContext(browser, app, { email: "mai@quire.local" });
    resources.defer(() => editor[Symbol.asyncDispose]());
    operator = await authenticatedContext(browser, app, { email: "operator@quire.local" });
    resources.defer(() => operator[Symbol.asyncDispose]());
  }, 120_000);

  afterAll(async () => {
    const previous: Traffic[] = await Bun.file(evidence).exists()
      ? JSON.parse(await Bun.file(evidence).text())
      : [];
    const merged = new Map(previous.map(observation => [observation.route, observation]));
    for (const observation of observations) merged.set(observation.route, observation);
    await Bun.write(evidence, JSON.stringify([...merged.values()], null, 2));
    await resources.disposeAsync();
    console.info("P2U_AUTHORITY_TRAFFIC_CLOSED", {
      web: app?.url.origin, api: app?.apiUrl.origin, root: app?.dataDir,
    });
  }, 90_000);

  async function setCapacity(value: number | null) {
    const response = await operator.context.request.put("/api/admin/project-benefits/deployment/local", {
      headers: { origin: app.url.origin, "x-csrf-token": operator.session.csrfToken },
      data: {
        expectedVersion: grantVersion,
        benefits: {
          compileSeconds: 180,
          writableMembers: value,
          historyDays: null,
          trackChanges: true,
        },
      },
    });
    expect(response.status()).toBe(200);
    grantVersion += 1;
  }

  for (const route of ["review", "history", "chat"] as const) {
    test(route, async () => {
      const page = await editor.context.newPage();
      try {
      const requests: string[] = [];
      page.on("request", request => {
        const key = requestKey(request);
        if (key) requests.push(key);
      });
      if (route === "review") {
        await openSurface(page, {
          path: `/projects/${fixtureIds.project}/review`,
          selector: '.quire-review__section[data-review-live="true"]',
        });
      } else if (route === "history") {
        await openSurface(page, {
          path: `/projects/${fixtureIds.project}/history`,
          selector: '.quire-history[data-review-live="true"]',
        });
      } else {
        await openSurface(page, {
          path: `/projects/${fixtureIds.project}/edit`,
          selector: ".qe-workspace",
        });
        await page.getByText("Workspace", { exact: true }).click();
        const live = await surfaceSignal(page, '.quire-review__section[data-review-live="true"]');
        await page.getByRole("button", { name: "Project chat", exact: true }).click();
        await live.observed;
      }
      const ready = await surfaceSignal(page, '[data-environment-state="ready"]');
      await ready.observed;
      const baseline = count(requests);

      // Metadata is requested by the mounted shell effect after a refreshed
      // workspace commits, unlike the earlier effective-access network response.
      const limited = page.waitForResponse(response =>
        new URL(response.url()).pathname.endsWith("/git/status") && response.status() === 200);
      await setCapacity(0);
      await (await limited).finished();
      const limitedCounts = count(requests);

      const restored = page.waitForResponse(response =>
        new URL(response.url()).pathname.endsWith("/git/status") && response.status() === 200);
      await setCapacity(null);
      await (await restored).finished();
      const restoredCounts = count(requests);

      observations.push({
        route,
        baseline,
        limited: limitedCounts,
        restored: restoredCounts,
        requests,
      });
      const baselineStreams = Object.entries(baseline)
        .filter(([key]) => key.startsWith("events?"))
        .reduce((total, [, value]) => total + value, 0);
      const restoredStreams = Object.entries(restoredCounts)
        .filter(([key]) => key.startsWith("events?"))
        .reduce((total, [, value]) => total + value, 0);
      expect(restoredStreams).toBe(baselineStreams);
      } finally {
        await page.close();
      }
    }, 90_000);
  }
});
