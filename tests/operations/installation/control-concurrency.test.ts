import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { requestDigest } from "../../../services/operations/installation/protocol";
import { controlFixture } from "./control-fixture";

test("real concurrent SQLite connections serialize changed actor/key commands", async () => {
  await using fixture = await controlFixture();
  const original = fixture.command("concurrent-key");
  const changedRequest = { ...original.request, autoSecurity: true };
  const commands = [original, { ...original, request: changedRequest, requestDigest: requestDigest(changedRequest) }];
  const workers = commands.map(command => {
    let readyResolve: () => void = () => { throw new Error("Ready subscription not installed"); };
    let resultResolve: (input: unknown) => void = () => { throw new Error("Result subscription not installed"); };
    const ready = new Promise<void>(resolve => { readyResolve = resolve; });
    const result = new Promise<unknown>(resolve => { resultResolve = resolve; });
    const child = Bun.spawn([
      process.execPath, `${import.meta.dir}/control-race-child.ts`, fixture.path, fixture.epoch,
      JSON.stringify(command), JSON.stringify(fixture.release),
    ], {
      stdout: "pipe", stderr: "pipe",
      ipc(input) {
        const message = z.object({ outcome: z.string() }).parse(input);
        if (message.outcome === "ready") readyResolve();
        else resultResolve(input);
      },
    });
    return { child, ready, result };
  });
  try {
    await Promise.all(workers.map(worker => worker.ready));
    for (const worker of workers) worker.child.send("accept");
    const results = z.array(z.discriminatedUnion("outcome", [
      z.object({ outcome: z.literal("accepted"), operationId: IdSchema }),
      z.object({ outcome: z.literal("error"), message: z.string() }),
    ])).parse(await Promise.all(workers.map(worker => worker.result)));
    expect(results.filter(result => result.outcome === "accepted")).toHaveLength(1);
    expect(results.filter(result => result.outcome === "error")).toEqual([{ outcome: "error", message: "IDEMPOTENCY_CONFLICT" }]);
    expect(await Promise.all(workers.map(worker => worker.child.exited))).toEqual([0, 0]);
    expect(fixture.store.list({ limit: 100 })).toHaveLength(1);
  } finally {
    for (const worker of workers) {
      if (worker.child.exitCode === null) worker.child.kill();
    }
    await Promise.all(workers.map(worker => worker.child.exited));
  }
}, 10_000);
