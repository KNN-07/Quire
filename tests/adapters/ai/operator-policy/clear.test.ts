import { expect, test } from "bun:test";
import { aiFixture } from "../harness";
import { providerServer } from "../provider";
import { AiOperatorPolicies } from "../../../../services/adapters/shared/provider-policy";

test("private session clear atomically closes its metadata log without retaining late content", async () => {
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin);
  const owner = await fixture.login();
  const operator = await fixture.login("operator@quire.local");
  await fixture.configure();
  const project = await fixture.project(owner);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  await new AiOperatorPolicies(fixture.ai.store.context).put(operator.user.id, {
    requestLogging: "retained-content", citationWebSearch: true, blockConfidentialTags: true, expectedVersion: 0,
  });
  const gate = provider.gate();
  try {
    const run = await fixture.ai.create(owner.actor, { key: crypto.randomUUID(),
      request: { scope, mode: "ask", tool: "chat", prompt: "never-retain-this-private-prompt", fileIds: [] } });
    await gate.entered;
    await fixture.ai.conversations.clearSession(owner.actor, scope);
    gate.release();
    expect((await fixture.ai.get(owner.actor, run.id)).run.status).toBe("canceled");
    expect(await fixture.runtime.db.get("SELECT status,encrypted_content FROM ai_request_logs WHERE run_id=?", [run.id]))
      .toEqual({ status: "canceled", encrypted_content: null });
    expect((await fixture.ai.store.usage(owner.actor, "2026-10")).used).toBe(1);
  } finally { gate.release(); }
});
