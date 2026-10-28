import { existsSync } from "node:fs";
import { at, controlFixture } from "./control-fixture";

const fixture = await controlFixture();
try {
  const command = fixture.command("evidence-key");
  console.log(JSON.stringify({ event: "provisioned", state: fixture.store.state() }));
  fixture.inhibit(command);
  console.log(JSON.stringify({ event: "inhibited", state: fixture.store.state() }));
  fixture.reopen();
  console.log(JSON.stringify({ event: "interrupted-reopened", state: fixture.store.state(), receipt: fixture.store.receipt(command.operationId) }));
  fixture.store.beginRecovery(fixture.recoveryCommand(command.operationId), at);
  fixture.stopped(command.operationId);
  const health = fixture.health(command.operationId, fixture.prior);
  fixture.store.commit({
    ...fixture.commitInput(command.operationId, health),
    binding: fixture.prior, outcome: "failed", successfulFloor: null,
    errorCode: "CONTROLLER_INTERRUPTED", resultBytes: '{ "verifiedUntouchedPrior": true }\n',
  });
  console.log(JSON.stringify({ event: "explicit-recovery-committed", state: fixture.store.state(), receipt: fixture.store.receipt(command.operationId) }));
} finally {
  await fixture[Symbol.asyncDispose]();
  console.log(JSON.stringify({ event: "owned-cleanup", root: fixture.root, exists: existsSync(fixture.root) }));
}
