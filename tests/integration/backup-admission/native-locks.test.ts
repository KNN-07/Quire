import { expect, test } from "bun:test";
import { fstat } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNever } from "@quire/contracts";
import { NativeMutationAdmission, nativeAdmissionDescriptor } from "../../../packages/runtime/src/native-admission";
import { repositoryGit } from "../../../packages/runtime/src/repository-process";
import { bounded } from "../portable/process";

test("preserves every live flock descriptor across concurrent acquisition, child exit and garbage collection", async () => {
  // Given concurrent native roles that retain their actual locked file descriptions.
  const root = await mkdtemp(join(tmpdir(), "quire-admission-fd-"));
  const admission = new NativeMutationAdmission(root);
  try {
    for (let wave = 0; wave < 4; wave++) {
      // Recycle descriptors previously passed to completed Git subprocesses.
      await Promise.all(Array.from({ length: 32 }, () => admission.writer(() =>
        repositoryGit(join(root, "repository.git"), ["--version"]))));
      const entered = Promise.withResolvers<void>();
      const inspect = Promise.withResolvers<void>();
      const failed = Promise.withResolvers<never>();
      let count = 0;
      const writers = Array.from({ length: 32 }, () => admission.writer(async () => {
        const fd = nativeAdmissionDescriptor();
        if (fd === undefined) throw new Error("Native authority descriptor is missing");
        if (++count === 32) entered.resolve();
        await inspect.promise;
        await new Promise<void>((resolve, reject) => {
          fstat(fd, (error, value) => error ? reject(error) :
            value.isFile() ? resolve() : reject(new Error("Authority is not a regular file")));
        });
      }));
      for (const writer of writers) void writer.catch((error: unknown) => failed.reject(error));
      const settled = Promise.allSettled(writers);
      try {
        await bounded(Promise.race([entered.promise, failed.promise]), 15000);
        // When completed flock helpers are collected while their descriptors are reused.
        Bun.gc(true);
        const competing = Bun.spawn(["flock", "--exclusive", "--nonblock", join(root, ".admission-writers.lock"), "true"],
          { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
        expect(await competing.exited).toBe(1);
      } finally { inspect.resolve(); await settled; }
      // Then every retained authority descriptor remains valid through callback completion.
      const results = await settled;
      for (const result of results) {
        switch (result.status) {
          case "fulfilled": break;
          case "rejected": throw result.reason;
          default: assertNever(result);
        }
      }
    }
    await admission.exclusive(async () => {
      const competing = Bun.spawn(["flock", "--shared", "--nonblock", join(root, ".admission-writers.lock"), "true"],
        { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
      expect(await competing.exited).toBe(1);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);
