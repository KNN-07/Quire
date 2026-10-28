import { expect, test } from "bun:test";
import { z } from "zod";
import { createRuntime } from "@quire/runtime";
import { DigestSchema } from "@quire/contracts";
import { fixtureIds as ids } from "../fixtures/foundation";
import { isolatedData } from "../fixtures/runtime";

test("persists example source when migrate and seed run through their real CLI", async () => {
  // Given: an empty owned data directory and native Bun.
  await using sandbox = await isolatedData();
  // When: the documented setup commands execute in a separate process.
  const command = Bun.spawn(["bash", "-c", "bun run db:migrate && bun run seed"], {
    cwd: new URL("../..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe",
    env: { PATH: process.env["PATH"], HOME: process.env["HOME"], TMPDIR: sandbox.path,
      QUIRE_DATA_DIR: sandbox.path },
  });
  const [, stderr, code] = await Promise.all([
    new Response(command.stdout).text(), new Response(command.stderr).text(), command.exited,
  ]);
  // Then: a new connection reads the users and content written by those processes.
  expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
  const runtime = await createRuntime(sandbox.config);
  try {
    expect(await runtime.db.all("SELECT id FROM users")).toHaveLength(6);
    const row = z.strictObject({ blob: DigestSchema }).parse(
      await runtime.db.get("SELECT blob FROM files WHERE id=?", [ids.mainFile]));
    const actual = await runtime.blobs.get(row.blob);
    const original = await Bun.file(new URL("../fixtures/example/main.tex", import.meta.url)).bytes();
    expect(actual).toEqual(original);
  } finally { await runtime.close(); }
});
