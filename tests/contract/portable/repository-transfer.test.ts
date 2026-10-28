import { test } from "bun:test";
import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IdSchema, GitOidSchema } from "@quire/contracts";
import { fixture } from "./fixture";

test("native named bundles exclude hidden ancestry and quarantined pack import changes no refs", async () => {
  const f = await fixture();
  try {
    const repositories = f.runtime.repositories;
    const project = IdSchema.parse(crypto.randomUUID());
    await repositories.initialize(project);
    const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes).trim();
    const treeBytes = await repositories.objects(project, ["mktree"], new Uint8Array());
    assert.ok(treeBytes instanceof Uint8Array);
    assert.equal(treeBytes.length, treeBytes.byteLength);
    const tree = text(treeBytes);
    const named = GitOidSchema.parse(`sha1:${text(await repositories.objects(project, ["commit-tree", tree, "-m", "public"]))}`);
    const hidden = GitOidSchema.parse(`sha1:${text(await repositories.objects(project, ["commit-tree", tree, "-m", "private"]))}`);
    const lease = await f.runtime.branches.acquire({ projectId: project, branch: "main" }, "transfer-test", 60000);
    assert.ok(lease);
    const id = IdSchema.parse(crypto.randomUUID());
    await repositories.publish({ id, lease, updates: [
      { ref: "refs/heads/main", expected: null, next: named },
      { ref: "refs/quire/history/main", expected: null, next: hidden },
    ] });
    await assert.rejects(repositories.exportNamed(project), { code: "REPOSITORY_NOT_FINALIZED" });
    await f.runtime.uow.run(tx => repositories.finalize(tx, id, lease));
    const bundle = join(f.root, "named.bundle");
    const bundleBytes = await repositories.exportNamed(project);
    assert.ok(bundleBytes instanceof Uint8Array);
    assert.equal(bundleBytes.length, bundleBytes.byteLength);
    await writeFile(bundle, bundleBytes);
    const clone = join(f.root, "public.git");
    const run = async (...args: string[]) => {
      const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
      const [bytes, error, code] = await Promise.all([new Response(child.stdout).bytes(), new Response(child.stderr).text(), child.exited]);
      return { bytes, error, code };
    };
    assert.equal((await run("clone", "--bare", bundle, clone)).code, 0);
    assert.equal((await run("--git-dir", clone, "cat-file", "-e", hidden.slice(5))).code, 1);
    const pack = await run("--git-dir", clone, "pack-objects", "--all", "--stdout");
    assert.equal(pack.code, 0);
    const target = IdSchema.parse(crypto.randomUUID());
    await repositories.initialize(target);
    await repositories.importPack(target, pack.bytes);
    assert.equal(text(await repositories.objects(target, ["cat-file", "-t", named.slice(5)])), "commit");
    assert.equal(text(await repositories.read(target, ["for-each-ref"])), "");
    await assert.rejects(repositories.importPack(target, new TextEncoder().encode("not a pack")), /GIT/);
    assert.equal(text(await repositories.read(target, ["for-each-ref"])), "");
  } finally { await f.close(); }
});
