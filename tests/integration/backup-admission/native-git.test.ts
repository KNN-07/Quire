import { test, expect } from "bun:test";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeMutationAdmission } from "../../../packages/runtime/src/native-admission";
import { repositoryGit } from "../../../packages/runtime/src/repository-process";
import { bounded } from "../portable/process";

test("a real Git child retains native exclusion after its parent authority closes", async () => {
  // Given an actual Git command held before execution by the existing socket probe.
  await using resources = new AsyncDisposableStack();
  const root = await mkdtemp(join(tmpdir(), "quire-admission-git-fd-"));
  resources.defer(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin);
  const probe = new URL("../../operations/repository/git-probe.ts", import.meta.url).href;
  await writeFile(join(bin, "git"), `#!${process.execPath}\nawait import(${JSON.stringify(probe)});\n`, { mode: 0o700 });
  const originalPath = process.env["PATH"];
  process.env["PATH"] = `${bin}:${originalPath ?? ""}`;
  resources.defer(() => {
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
  });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const listener = createServer(socket => {
    socket.once("data", () => {
      entered.resolve();
      void release.promise.then(() => { socket.write("run\n"); });
    });
  });
  const listening = once(listener, "listening");
  listener.listen(join(root, ".probe.sock"));
  await listening;
  resources.defer(() => new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())));
  let command: Promise<Uint8Array> | undefined;
  resources.defer(async () => { release.resolve(); if (command) await Promise.allSettled([command]); });
  const admission = new NativeMutationAdmission(root);
  const repository = join(root, "project.git");
  await admission.writer(async () => {
    command = repositoryGit(repository, ["init", "--bare", "--initial-branch=main", repository]);
    await bounded(Promise.race([entered.promise, command.then(() => {
      throw new Error("Git exited before the exact execution barrier");
    })]));
  });

  // When the parent's open file description is closed but the Git child is still alive.
  const blocked = Bun.spawn(["flock", "--exclusive", "--nonblock", join(root, ".admission-writers.lock"), "true"],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  expect(await blocked.exited).toBe(1);
  release.resolve();
  await command;

  // Then exclusion lasts through real Git exit and the completed repository is visible.
  await admission.exclusive(async () => {
    expect(await Bun.file(join(repository, "HEAD")).text()).toBe("ref: refs/heads/main\n");
  });
}, 30000);
