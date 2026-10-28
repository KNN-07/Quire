import { expect, test } from "bun:test";
import { createClient } from "@quire/contracts";
import { EditorSessionController } from "../../../apps/web/src/features/editor/session-controller";
import { baseFixture, origin } from "../../core/base/harness";
import { fixtureIds } from "../../fixtures/foundation";
import { bounded } from "../../integration/portable/process";

test("a policy refresh requested during an older authority read observes the committed policy", async () => {
  await using fixture = await baseFixture();
  const editor = await fixture.login("mai@quire.local");
  const operator = await fixture.login("operator@quire.local");
  const scope = { projectId: fixtureIds.project, branch: "main" };
  let holdNextAccess = false;
  const captured = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const bridge = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      // File-list discovery is outside this controller authority test. Omit
      // documents so no independent websocket authority reader participates.
      // Sessions, projects, effective access and grant mutations remain real.
      if (new URL(request.url).pathname === `/api/projects/${scope.projectId}/files`) {
        return Response.json({ data: [], requestId: crypto.randomUUID() });
      }
      const headers = new Headers(request.headers);
      headers.set("cookie", editor.headers.cookie);
      headers.set("origin", origin);
      const response = await fixture.runtime.routes.fetch(new Request(request, { headers }));
      if (holdNextAccess && new URL(request.url).pathname.endsWith("/effective-access")) {
        holdNextAccess = false;
        captured.resolve();
        await release.promise;
      }
      return response;
    },
  });
  const controller = new EditorSessionController(createClient(bridge.url.origin), {
    ...scope, page: "review", shareToken: null,
  });
  try {
    await controller.start();
    const initial = controller.getSnapshot();
    if (initial.kind !== "ready") throw new Error("Expected an initialized editor");
    expect(initial.workspace.access.effectiveRole).toBe("editor");
    // Hold the real pre-change response, then commit the grant before asking
    // the controller to refresh again. No timer decides the response ordering.
    holdNextAccess = true;
    const oldRead = controller.refresh();
    await bounded(captured.promise);
    const grant = await fixture.request("/api/admin/project-benefits/deployment/local", {
      method: "PUT", headers: operator.headers,
      body: JSON.stringify({
        expectedVersion: 0,
        benefits: { compileSeconds: 60, writableMembers: 0, historyDays: 7, trackChanges: false },
      }),
    });
    expect(grant.status).toBe(200);
    const currentRead = controller.refresh();
    release.resolve();
    await bounded(Promise.all([oldRead, currentRead]));
    const current = controller.getSnapshot();
    if (current.kind !== "ready") throw new Error("Expected a refreshed editor");
    expect(current.workspace.access.role).toBe("editor");
    expect(current.workspace.access.effectiveRole).toBe("viewer");
    expect(current.workspace.access.benefits.writableMembers).toBe(0);
  } finally {
    release.resolve();
    await controller.dispose();
    await bridge.stop(true);
  }
}, 30_000);
