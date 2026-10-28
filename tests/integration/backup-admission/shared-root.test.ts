import { test, expect } from "bun:test";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { BackupSchema, IdSchema, OperationSchema } from "@quire/contracts";
import { scaleFixture } from "./fixture";

test("one API creates a durable archive that another API verifies through the shared policy destination", async () => {
  // Given two actual API OS processes with private data dirs and one owned shared archive directory.
  await using fixture = await scaleFixture();
  await fixture.first.call("release-backup");
  const login = await fetch(new URL("/api/auth/login", fixture.firstUrl), {
    method: "POST", headers: { origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({ email: "operator@quire.local", password: "quire-admission-scale-test" }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error(`Operator login failed: ${login.status}`);
  const identity = await fetch(new URL("/api/me", fixture.firstUrl), { headers: { cookie } });
  const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await identity.json()).data.csrfToken;
  for (const url of [fixture.firstUrl, fixture.secondUrl]) {
    const policy = await fetch(new URL("/api/admin/backups/policy", url), { headers: { cookie } });
    expect(z.object({ data: z.object({ destination: z.string() }) }).parse(await policy.json()).data.destination).toBe(fixture.backupRoot);
  }
  const headers = { cookie, origin: "http://localhost:5173", "content-type": "application/json",
    "x-csrf-token": csrf, "idempotency-key": crypto.randomUUID() };

  // When API one creates the archive and API two verifies that same SQL record and physical directory.
  const created = await fetch(new URL("/api/admin/backups", fixture.firstUrl), {
    method: "POST", headers, body: "{}",
  });
  expect(created.status).toBe(202);
  const backup = z.object({ data: BackupSchema }).parse(await created.json()).data;
  await fixture.first.close();
  await rm(join(fixture.root, "first"), { recursive: true, force: true });
  const verified = await fetch(new URL(`/api/admin/backups/${backup.id}/verify`, fixture.secondUrl), {
    method: "POST", headers: { ...headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: 0 }),
  });
  expect(verified.status).toBe(202);
  const operation = z.object({ data: OperationSchema }).parse(await verified.json()).data;

  // Then both operations are terminal, paths remain owned, and the second API reads the same archive.
  expect(backup.status).toBe("succeeded");
  expect(backup.destination).toBe(join(fixture.backupRoot, backup.id));
  expect(operation.status).toBe("succeeded");
  expect(operation.result?.["manifestDigest"]).toBe(backup.manifestDigest);
  for (const id of [IdSchema.parse(backup.operationId), operation.id]) {
    const response = await fetch(new URL(`/api/operations/${id}`, fixture.secondUrl), { headers: { cookie } });
    expect(z.object({ data: OperationSchema }).parse(await response.json()).data.status).toBe("succeeded");
  }
  const listed = await fetch(new URL("/api/admin/backups", fixture.secondUrl), { headers: { cookie } });
  const records = z.object({ data: z.object({ items: z.array(BackupSchema) }) }).parse(await listed.json()).data.items;
  expect(BackupSchema.parse(records.find(record => record.id === backup.id)).verifiedAt).toBeString();
}, 120000);
