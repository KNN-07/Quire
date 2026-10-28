import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdir, chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { GitOidSchema, IdSchema } from "@quire/contracts";
import { fixture } from "./fixture";

test("real repository Git children run outside SQL admission, publication and finalization transactions", async () => {
  const f = await fixture();
  const originalPath = process.env["PATH"];
  const git = Bun.which("git");
  const bun = Bun.which("bun");
  if (!git || !bun) { await f.close(); throw new Error("Native Git and Bun are required"); }
  try {
    const bin = join(f.root, "probe-bin");
    await mkdir(bin);
    const launcher = join(bin, "git");
    const probe = new URL("../../fixtures/repository-git-probe.ts", import.meta.url).pathname;
    await Bun.write(launcher, `#!${bun}\nimport { probe } from ${JSON.stringify(probe)};\nawait probe(${JSON.stringify(git)}, process.argv.slice(2));\n`);
    await chmod(launcher, 0o700);
    process.env["PATH"] = `${bin}:${originalPath ?? ""}`;
    const projectId = IdSchema.parse(crypto.randomUUID());
    await f.runtime.repositories.initialize(projectId);
    // Positive control: the external probe detects a real SQL writer transaction.
    await rejects(f.runtime.uow.run(() => f.runtime.repositories.objects(projectId, ["mktree"], new Uint8Array())),
      (error: unknown) => error instanceof Error && error.message.includes("database is locked"));
    const tree = new TextDecoder().decode(await f.runtime.repositories.objects(projectId, ["mktree"], new Uint8Array())).trim();
    const oid = new TextDecoder().decode(await f.runtime.repositories.objects(projectId, ["commit-tree", tree, "-m", "boundary"])).trim();
    const lease = await f.runtime.branches.acquire({ projectId, branch: "main" }, "boundary", 60000);
    if (!lease) throw new Error("Lease unavailable");
    const id = IdSchema.parse(crypto.randomUUID());
    await f.runtime.repositories.publish({
      id, lease, updates: [{ ref: "refs/heads/main", expected: null, next: GitOidSchema.parse(`sha1:${oid}`) }],
    });
    await rejects(f.runtime.repositories.read(projectId, ["rev-parse", "refs/heads/main"]),
      { code: "REPOSITORY_NOT_FINALIZED" });
    await f.runtime.repositories.recover(id, lease);
    await f.runtime.uow.run((tx) => f.runtime.repositories.finalize(tx, id, lease));
    expect(new TextDecoder().decode(await f.runtime.repositories.read(projectId, ["rev-parse", "refs/heads/main"])).trim()).toBe(oid);
    const commands = (await readFile(join(f.root, "git-transaction-probes.jsonl"), "utf8")).trim().split("\n")
      .map((line) => z.strictObject({ command: z.string() }).parse(JSON.parse(line)).command);
    for (const command of ["init", "config", "mktree", "commit-tree", "check-ref-format", "for-each-ref", "update-ref", "rev-parse"]) {
      expect(commands).toContain(command);
    }
  } finally {
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
    await f.close();
  }
});
