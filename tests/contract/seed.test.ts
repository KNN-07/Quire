import { expect, test } from "bun:test";
import * as Y from "yjs";
import { createRuntime } from "@quire/runtime";
import { z } from "zod";
import { seed } from "../../scripts/seed";
import { fixtureIds as ids, exampleFiles, seedUsers } from "../fixtures/foundation";
import { isolatedData } from "../fixtures/runtime";
import { join } from "node:path";

test("persists seeded users tree and Git when the runtime restarts", async () => {
  // Given: an isolated migrated data directory.
  await using sandbox = await isolatedData();
  const first = await createRuntime(sandbox.config);
  // When: seed runs and a new runtime opens the same directory.
  const created = await seed(first);
  await first.close();
  const reopened = await createRuntime(sandbox.config);
  try {
    // Then: persisted identities, source bytes, Yjs state and actual Git agree.
    const users = await reopened.db.all("SELECT id FROM users ORDER BY id");
    expect(users).toHaveLength(seedUsers.length);
    const row = z.strictObject({ password_hash: z.string() }).parse(await reopened.db.get("SELECT password_hash FROM users WHERE id=?", [ids.kien]));
    expect(created.password !== null && await Bun.password.verify(created.password, row.password_hash)).toBe(true);
    const files = await reopened.db.all("SELECT path FROM files WHERE branch_id=? ORDER BY path", [ids.branch]);
    expect(files).toEqual([...exampleFiles].sort((a, b) => a.path.localeCompare(b.path)).map((file) => ({ path: file.path })));
    const docRow = z.strictObject({ text: z.string(), state: z.instanceof(Uint8Array) }).parse(
      await reopened.db.get("SELECT text,state FROM document_states WHERE file_id=?", [ids.mainFile]));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, docRow.state);
    expect(doc.getText("source").toJSON()).toBe(docRow.text);
    doc.destroy();
    const git = Bun.spawn(["git", "--git-dir", join(sandbox.path, "git", `${ids.project}.git`), "show", "main:main.tex"], { stdout: "pipe", stderr: "pipe" });
    expect(await new Response(git.stdout).text()).toBe(docRow.text);
    expect(await git.exited).toBe(0);
    const again = await seed(reopened);
    expect(again).toEqual({ createdUsers: 0, password: null });
    expect(await reopened.db.all("SELECT id FROM projects")).toHaveLength(1);
    expect(await reopened.db.all("PRAGMA foreign_key_check")).toEqual([]);
  } finally { await reopened.close(); }
});
