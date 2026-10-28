import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { createRuntime, loadConfig, createLocalAdapters } from "@quire/runtime";
import { seed } from "../../../scripts/seed";
import { fixture } from "./fixture";

test("native async seed persists real users, blobs, documents and Git and is idempotent", async () => {
  const f = await fixture();
  try {
    expect((await seed(f.runtime, "portable-native-password")).createdUsers).toBe(6);
    expect((await seed(f.runtime, "portable-native-password")).createdUsers).toBe(0);
    expect(await f.runtime.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM projects")).toEqual({ count: 1 });
    expect(await f.runtime.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM document_states")).toEqual({ count: 6 });
    const blobs = await f.runtime.db.all<{ digest: string; bytes: number }>("SELECT digest,bytes FROM blobs");
    expect(blobs.length).toBeGreaterThan(0);
    expect(blobs.every((row) => row.bytes > 0)).toBe(true);
  } finally { await f.close(); }
});

test("scale startup refuses absent or native adapters rather than claiming fallback", async () => {
  await rejects(createRuntime(loadConfig({ QUIRE_PROFILE: "scale" })), { code: "PROFILE_UNAVAILABLE" });
  const f = await fixture();
  try {
    await rejects(createRuntime({ ...f.runtime.config, profile: "scale" }, {
      createAdapters: createLocalAdapters,
    }), { code: "PROFILE_ADAPTER_MISMATCH" });
  } finally { await f.close(); }
});
