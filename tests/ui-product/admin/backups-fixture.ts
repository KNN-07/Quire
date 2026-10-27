import { BackupSchema, endpoints, resourceVersionTag } from "@quire/contracts";
import type { Backup } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";

export function backupsFixture() {
  let version = 11;
  let policy = { schedule: "0 3 * * *", retentionDays: 30, destination: "/fixture/backups", version: 5 };
  let backups: readonly Backup[] = [BackupSchema.parse({
    id: "00000000-0000-4000-8000-000000000501", status: "succeeded",
    createdAt: "2026-10-26T03:00:00Z", manifestDigest: "a".repeat(64),
    destination: "/fixture/backups/2026-10-26", verifiedAt: "2026-10-26T03:05:00Z",
    operationId: "00000000-0000-4000-8000-000000000502",
  })];
  const reply = (data: unknown, counter = version) => Response.json(
    { data, requestId: fixtureIds.operator }, { headers: { etag: resourceVersionTag(counter) } },
  );
  const stale = () => Response.json({ error: { code: "STALE_VERSION", message: "Backup state changed." }, requestId: fixtureIds.operator }, { status: 409 });
  return (request: Request, url: URL, body: unknown): Response | null => {
    if (!url.pathname.startsWith("/api/admin/backups")) return null;
    if (url.pathname === "/api/admin/backups/policy") {
      if (request.method === "GET") return reply(policy, policy.version);
      const input = endpoints.backupPolicyPut.input.parse({ params: {}, query: {}, body, headers: Object.fromEntries(request.headers) });
      if (input.body.expectedVersion !== policy.version || request.headers.get("if-match") !== resourceVersionTag(policy.version)) return stale();
      policy = { schedule: input.body.schedule, retentionDays: input.body.retentionDays,
        destination: input.body.destination, version: policy.version + 1 };
      return reply({ ok: true, version: policy.version }, policy.version);
    }
    if (url.pathname === "/api/admin/backups") {
      if (request.method === "GET") return reply({ items: backups, nextCursor: null });
      endpoints.backupCreate.input.parse({ params: {}, query: {}, body });
      const backup = BackupSchema.parse({
        id: crypto.randomUUID(), status: "queued", createdAt: "2026-10-26T13:00:00Z",
        manifestDigest: null, destination: policy.destination, verifiedAt: null, operationId: crypto.randomUUID(),
      });
      backups = [backup, ...backups]; version += 1;
      return reply(backup);
    }
    const id = url.pathname.split("/")[4];
    if (!id) return null;
    if (url.pathname.endsWith("/verify")) {
      const input = endpoints.backupVerify.input.parse({ params: { id }, query: {}, body });
      if (input.body.expectedVersion !== version) return stale();
    } else {
      const input = endpoints.backupRestore.input.parse({ params: { id }, query: {}, body });
      if (input.body.expectedVersion !== version) return stale();
      if (input.body.confirmation !== "RESTORE") return Response.json({ error: { code: "CONFIRMATION_REQUIRED", message: "Confirm restore." }, requestId: fixtureIds.operator }, { status: 400 });
    }
    return reply({ id: crypto.randomUUID(), kind: "backup.fixture-operation", status: "queued",
      progress: 0, result: null, errorCode: null });
  };
}
