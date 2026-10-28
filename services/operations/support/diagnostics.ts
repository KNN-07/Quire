import { z } from "zod";
import { IdSchema, OperationSchema, endpoints } from "@quire/contracts";
import { referenceBlob, ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { currentOperator, operator } from "./access";
import { compilerProbe, portProbe, runtimeProbes, toolProbes } from "./probes";

export const bundleContents = [
  "manifest: contents and omissions", "runtime: Bun version, SQL dialect and executed read",
  "tools: fixed executable names, actual version-command exit codes (no command output)",
  "sandbox: actual confined compiler/PDF probe status", "ports: configured API TCP connectivity (no address)",
  "configuration: local/scale profile, sandbox backend, SIEM enabled/secret-presence flags",
  "repositories: real repository-port read status (no project identifier)",
  "compilerProfiles: counts of persisted installed/probed profiles, not current availability",
] as const;
export const bundleOmissions = [
  "all project source and generated documents", "all environment variable values",
  "credentials, tokens, keys and encrypted credentials", "names, emails, IPs and inquiry bodies",
  "database rows and dumps", "filesystem paths, endpoints and subprocess stdout/stderr",
  "audit details and identifiers", "provider configuration values",
] as const;

/** An allowlist, not a regex scrub of arbitrary records: private data never enters the artifact. */
export async function diagnosticBytes(context: ModuleContext): Promise<Uint8Array> {
  const [runtime, tools, sandbox, port] = await Promise.all([
    runtimeProbes(context), toolProbes(), compilerProbe(),
    portProbe(context.config.host, context.config.port),
  ]);
  const siem = z.object({ enabled: z.number(), present: z.number() }).nullable().parse(
    await context.db.get("SELECT enabled,CASE WHEN encrypted_secret IS NULL THEN 0 ELSE 1 END AS present FROM support_siem WHERE id=1"));
  const bytes = new TextEncoder().encode(JSON.stringify({
    manifest: { format: "quire-support-v1", redacted: true, contents: bundleContents, omitted: bundleOmissions },
    at: context.clock.now(), runtime, tools, sandbox, ports: { api: port },
    configuration: { profile: context.config.profile, sandboxBackend: context.config.compilerBackend,
      siem: { configured: siem !== null, enabled: siem?.enabled === 1, secretPresent: siem?.present === 1 } },
  }, null, 2));
  return bytes;
}

export function registerDiagnostics(context: ModuleContext): void {
  context.routes.register(endpoints.diagnosticsCreate, async (input, request) => {
    const principal = await operator(context, request.request);
    const key = z.string().min(1).max(200).parse(input.headers["idempotency-key"]);
    const prior = await context.db.get("SELECT * FROM operations WHERE actor_id=? AND idempotency_key=?",
      [principal.user.id, key]);
    if (prior) {
      return context.uow.run(async tx => {
        await tx.lock("quire:accounts");
        await currentOperator(tx, principal.user.id);
        return readOperation(prior);
      });
    }
    const bytes = await diagnosticBytes(context);
    const blob = await context.blobs.put(bytes);
    const operation = await context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await currentOperator(tx, principal.user.id);
      const previous = await tx.get("SELECT * FROM operations WHERE actor_id=? AND idempotency_key=?", [principal.user.id, key]);
      if (previous) return readOperation(previous);
      const id = IdSchema.parse(crypto.randomUUID());
      const now = context.clock.now();
      await referenceBlob(tx, { digest: blob, bytes: bytes.length }, context.clock);
      const result = { blob, projectIds: [], operatorOnly: true, mime: "application/json",
        filename: "quire-support.json", contents: bundleContents, redacted: true };
      await tx.run(`INSERT INTO operations
        (id,actor_id,kind,status,progress,result_json,idempotency_key,created_at,updated_at)
        VALUES(?,?,?,'succeeded',1,?,?,?,?)`, [id, principal.user.id, "support-diagnostics", JSON.stringify(result), key, now, now]);
      await context.events.record(tx, { topic: "operation.changed", aggregateId: id, payload: { resourceId: id, status: "succeeded" } });
      return OperationSchema.parse({ id, kind: "support-diagnostics", status: "succeeded", progress: 1, result, errorCode: null });
    });
    await context.events.dispatch();
    return operation;
  });
}

function readOperation(value: unknown) {
  const row = z.object({ id: IdSchema, kind: z.string(), status: z.string(),
    progress: z.number(), result_json: z.string().nullable(), error_code: z.string().nullable() }).parse(value);
  if (row.kind !== "support-diagnostics") {
    throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Operation key belongs to a different operation");
  }
  return OperationSchema.parse({ id: row.id, kind: row.kind, status: row.status, progress: row.progress,
    result: row.result_json ? JSON.parse(row.result_json) : null, errorCode: row.error_code });
}
