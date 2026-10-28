import { strict as assert } from "node:assert";
import { z } from "zod";
import { ThreadSchema } from "@quire/contracts";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { password } from "./fixture";
import type { backupFixture } from "./fixture";
import { compileForDrill } from "./compile-fixture";

/** Nonempty review/history/receipt data and a real PDF for both storage profiles. */
export async function prepareCompleteData(fixture: Awaited<ReturnType<typeof backupFixture>>) {
  const signedIn = await fixture.request("/api/auth/login", { body: { email: "kien@quire.local", password } });
  const cookie = signedIn.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const me = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(
    await (await fixture.request("/api/me", { headers: { cookie } })).json());
  const headers = { cookie, "x-csrf-token": me.data.csrfToken } as const;
  const scope = { projectId: ids.project, branch: "main" } as const;
  const threadKey = crypto.randomUUID();
  const threadInput = { scope, body: "Recovery comment that must survive", expectedVersion: 0 } as const;
  const response = await fixture.request(`/api/projects/${ids.project}/threads`, {
    headers: { ...headers, "idempotency-key": threadKey }, body: threadInput,
  });
  const thread = z.object({ data: ThreadSchema }).parse(await response.json()).data;
  const doomed = z.object({ data: ThreadSchema }).parse(await (await fixture.request(`/api/projects/${ids.project}/threads`, {
    headers, body: { scope, body: "Irreversible tombstone fixture", expectedVersion: 0 },
  })).json()).data;
  const comment = doomed.comments[0];
  assert.ok(comment);
  assert.equal((await fixture.request(`/api/projects/${ids.project}/comments/${comment.id}`, {
    headers, method: "DELETE", body: { expectedVersion: 0 },
  })).status, 200);
  const compiled = await compileForDrill(fixture.runtime);
  return { headers, thread, comment, threadKey, threadInput, threadStatus: response.status, ...compiled } as const;
}
