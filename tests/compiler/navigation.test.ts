import { test, expect } from "bun:test";
import { compilerFixture, fixtureIds as ids, terminalEvent, settings } from "./fixtures";
import { syncTex } from "../../services/compiler/navigation";
import { CompilerService } from "../../services/compiler/service";
import { z } from "zod";

test("T09 performs real forward and reverse SyncTeX with snapshot file identities", async () => {
  // Given a real compiled source whose known text is on line 3.
  await using runtime = await compilerFixture();
  const snapshot = await runtime.replaceSnapshot("\\documentclass{article}\n\\begin{document}\nKnown navigation text.\n\\end{document}");
  const done = terminalEvent(runtime);
  await runtime.start();
  const job = await runtime.services.get("compiler").enqueue(ids.kien, { scope: snapshot.scope,
    expectedRevision: snapshot.revision, settings, clean: true }, "navigation");
  await done;
  const service = runtime.services.get("compiler");
  if (!(service instanceof CompilerService)) throw new TypeError("Compiler module was not registered");
  // When real SyncTeX maps line 3 to a PDF position and back.
  const forward = await syncTex(service, ids.kien, { params: { id: job.id }, query: {}, body: { direction: "forward", fileId: ids.mainFile, line: 3, column: 0 } });
  const first = z.object({ page: z.number(), xPt: z.number(), yPt: z.number() }).parse(forward[0]);
  const reverse = await syncTex(service, ids.kien, { params: { id: job.id }, query: {}, body: { direction: "reverse", ...first } });
  // Then the real snapshot identity and line are recovered.
  expect(reverse).toContainEqual({ fileId: ids.mainFile, line: 3, column: 0 });
}, 60000);
