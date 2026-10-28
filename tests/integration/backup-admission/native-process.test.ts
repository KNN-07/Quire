import { test, expect } from "bun:test";
import { rejects } from "node:assert/strict";
import { join } from "node:path";
import { runtimeFixture } from "../../fixtures/runtime";
import { AdmissionProcess } from "./fixture";
import { bounded } from "../portable/process";

test("excludes a second native OS process sharing the same SQLite and Git source root", async () => {
  // Given another live native role admitted against the same source directory.
  await using runtime = await runtimeFixture();
  await runtime.db.exec("CREATE TABLE native_process_probe(value TEXT)");
  const child = new AdmissionProcess({ root: runtime.config.dataDir }, join(import.meta.dir, "native-process.ts"));
  await child.started();
  const entered = child.signal("writer");
  const writing = child.call("write");
  await entered;
  const acquired = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let captured = false;
  // When this process closes admission and waits for the other process's lock.
  const backup = runtime.admission.exclusive(async () => {
    captured = true;
    expect(await runtime.db.get<{ value: string }>("SELECT value FROM native_process_probe")).toEqual({ value: "other process" });
    acquired.resolve();
    await release.promise;
  });
  try {
    await rejects(runtime.db.run("INSERT INTO native_process_probe(value) VALUES('forbidden')"), { code: "BACKUP_MAINTENANCE" });
    expect(captured).toBe(false);
    await child.call("release-writer");
    await writing;
    await acquired.promise;
    // Then the second OS process cannot start a new source writer during export.
    await rejects(child.call("sql"), /BACKUP_MAINTENANCE/);
    release.resolve();
    await backup;
    await child.call("sql");
  } finally {
    release.resolve();
    await child.call("release-writer");
    await bounded(backup);
    await child.close();
  }
});
