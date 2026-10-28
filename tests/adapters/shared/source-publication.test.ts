import { expect, test } from "bun:test";
import { z } from "zod";
import { GitOidSchema, IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { CoreProjects } from "../../../services/core/base";
import { defineAction, SafeHttpClient } from "../../../services/adapters/shared";
import type { AdapterContribution } from "../../../services/adapters/shared";
import { adapterFixture } from "./harness";
import { fixtureContribution } from "./contribution";
import { providerServer } from "./provider-server";
import { configure, connect } from "./connection";
import { fixtureIds } from "../../fixtures/foundation";

test("publishes real prepared Git source and adapter receipt in the same fenced transaction", async () => {
  // Given
  await using provider = providerServer();
  const contribution: AdapterContribution = (services) => {
    const definition = fixtureContribution()(services);
    return { ...definition, actions: {
      import: defineAction(z.strictObject({ text: z.string() }), {
        projectAccess: "write",
        async prepare(parameters, context) {
          const projects = new CoreProjects(services.context);
          if (!context.projectId) throw new ServiceError("PROJECT_REQUIRED", 400, "Project required");
          const scope = { projectId: context.projectId, branch: "main" };
          const lease = await services.context.branches.acquire(scope, crypto.randomUUID(), 60_000);
          if (!lease) throw new ServiceError("BRANCH_BUSY", 409, "Branch busy");
          try {
            const branch = await projects.getBranch(scope);
            const files = await projects.listFiles(scope);
            const source = await projects.prepareSource({
              actorId: context.actorId, scope, lease, expectedRevision: branch.revision,
              inputs: files.map((file) => file.id === fixtureIds.mainFile
                ? { file, bytes: new TextEncoder().encode(parameters.text) } : { file }),
            });
            const id = IdSchema.parse(crypto.randomUUID());
            await services.context.repositories.publish({ id, lease, updates: [{
              ref: `refs/quire/history/${source.snapshot.id}`, expected: null,
              next: GitOidSchema.parse(`sha1:${source.commit}`),
            }] });
            return {
              result: { snapshotId: source.snapshot.id }, cursor: "import-1",
              async publish(tx) {
                const events = await projects.finalizePreparedSources(tx, {
                  publication: { id, lease }, sources: [{ source, lease }],
                });
                for (const event of events) await services.context.events.record(tx, event);
              },
              release: () => services.context.branches.release(lease),
            };
          } catch (error) { await services.context.branches.release(lease); throw error; }
        },
      }),
    } };
  };
  await using fixture = await adapterFixture({ contributions: [contribution],
    http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
  await configure(fixture, provider.origin);
  const owner = await fixture.login();
  const grant = await connect(fixture, owner);
  const text = "\\documentclass{article}\n\\begin{document}Imported adapter source\\end{document}\n";
  // When
  const response = await fixture.request(`/api/connections/${grant.id}/actions`, {
    method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ action: "import", projectId: fixtureIds.project, parameters: { text },
      expectedCursor: null, expectedVersion: 1 }),
  });
  // Then
  expect(response.status).toBe(202);
  expect((await fixture.service.readDocument({ projectId: fixtureIds.project, branch: "main" }, fixtureIds.mainFile)).text).toBe(text);
  await fixture.runtime.repositories.assertReadable(fixtureIds.project);
  await fixture.restart();
  expect((await fixture.service.readDocument({ projectId: fixtureIds.project, branch: "main" }, fixtureIds.mainFile)).text).toBe(text);
  expect(await fixture.runtime.db.get<{ cursor: string }>("SELECT cursor FROM adapter_cursors WHERE grant_id=?", [grant.id]))
    .toEqual({ cursor: "import-1" });
});
