import { z } from "zod";
import { assertNever, CompileSettingsSchema, EnvironmentSchema, IdSchema } from "@quire/contracts";
import type { Environment, Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { ManifestInputSchema, digest } from "./model";
import type { ProbeReport } from "./model";

export const nativeDigests = new WeakMap<object,string>();
export type EnvironmentActor = {readonly id:Id;readonly sessionId:Id};
export async function requireOperator(context:Pick<ModuleContext,"db"|"clock">,actor:EnvironmentActor):Promise<void> {
  const active=await context.db.get(`SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id
    WHERE u.id=? AND s.id=? AND s.expires_at>? AND u.operator=1 AND u.suspended=0 AND u.deleted_at IS NULL`,
    [actor.id,actor.sessionId,context.clock.now()]);
  if (!active) throw new ServiceError("FORBIDDEN",403,"Current operator session is required");
}
const RowSchema = z.object({
  manifest_json: z.string(), available: z.number(), retired_at: z.string().nullable(),
  is_default: z.number(), version: z.number(), manifest_digest: z.string().nullable(),
});
export async function environmentRecord(context: Pick<ModuleContext, "db">, id: Id) {
  const value = await context.db.get(`SELECT e.manifest_json,e.available,e.retired_at,e.is_default,
    coalesce(r.version,0) AS version,r.manifest_digest FROM environments e
    LEFT JOIN environment_receipts r ON r.environment_id=e.id WHERE e.id=?`, [id]);
  if (!value) throw new ServiceError("ENVIRONMENT_NOT_FOUND", 404, "Compiler environment not found");
  const row = RowSchema.parse(value);
  const manifest = EnvironmentSchema.parse(JSON.parse(row.manifest_json));
  return { manifest: EnvironmentSchema.parse({ ...manifest, available: row.available === 1 && !row.retired_at }),
    version: row.version, retiredAt: row.retired_at, isDefault: row.is_default === 1, digest: row.manifest_digest };
}
export async function resolveEnvironment(context: Pick<ModuleContext, "db" | "services">, id: Id): Promise<Environment> {
  const record = await environmentRecord(context, id);
  if (!record.manifest.available) throw new ServiceError("ENVIRONMENT_UNAVAILABLE", 503, "Compiler environment is unavailable or retired");
  if (record.manifest.backend === "docker" &&
      record.digest !== digest(JSON.stringify(ManifestInputSchema.parse(record.manifest)))) {
    throw new ServiceError("ENVIRONMENT_UNTRUSTED", 503, "Manifest has no matching executed probe receipt");
  }
  if (record.manifest.backend === "bwrap" && (id !== "00000000-0000-4000-8000-000000000030" ||
      nativeDigests.get(context.services) !== record.manifest.rootOrImageDigest)) {
    throw new ServiceError("ENVIRONMENT_UNTRUSTED", 503, "Only the startup-probed native environment may use bwrap");
  }
  return record.manifest;
}
export async function listEnvironments(context: Pick<ModuleContext, "db">, input: {
  readonly cursor?: string; readonly limit: number;
}) {
  const rows = await context.db.all<{ id: string }>(
    "SELECT id FROM environments WHERE id>? ORDER BY id LIMIT ?", [input.cursor ?? "", input.limit + 1]);
  const visible = rows.slice(0, input.limit);
  const records = await Promise.all(visible.map(row => environmentRecord(context, IdSchema.parse(row.id))));
  return { records, items: records.map(record => record.manifest),
    nextCursor: rows.length > input.limit ? visible.at(-1)?.id ?? null : null };
}
export async function saveEnvironment(context: ModuleContext, input: {
  readonly manifest: Environment; readonly report: ProbeReport; readonly actor: EnvironmentActor;
  readonly receipt?: { readonly key: string; readonly digest: string };
}) {
  const hash = digest(JSON.stringify(ManifestInputSchema.parse(input.manifest)));
  return context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await requireOperator({...context,db:tx},input.actor);
    await tx.lock("quire:environments");
    if (input.receipt) {
      const previous = await tx.get("SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND key=? AND route=?",
        [input.actor.id,input.receipt.key,"environment-create"]);
      if (previous) {
        const row = z.object({request_digest:z.string(),response_json:z.string()}).parse(previous);
        if (row.request_digest !== input.receipt.digest) throw new ServiceError("IDEMPOTENCY_CONFLICT",409,"Create key belongs to a different manifest");
        return EnvironmentSchema.parse(JSON.parse(row.response_json));
      }
    }
    const existing = await tx.get("SELECT id FROM environments WHERE id=?", [input.manifest.id]);
    if (existing) throw new ServiceError("IMMUTABLE_ENVIRONMENT", 409, "Environment IDs cannot be overwritten");
    await tx.run(`INSERT INTO environments(id,label,release,backend,manifest_json,available,probe_at,created_at)
      VALUES(?,?,?,?,?,?,?,?)`, [input.manifest.id,input.manifest.label,input.manifest.release,input.manifest.backend,
      JSON.stringify(input.manifest),Number(input.manifest.available),input.manifest.probeAt,context.clock.now()]);
    await tx.run(`INSERT INTO environment_receipts(environment_id,report_json,manifest_digest,created_by)
      VALUES(?,?,?,?)`, [input.manifest.id,JSON.stringify(input.report),hash,input.actor.id]);
    await tx.run(`INSERT INTO audit_entries(id,at,actor_id,event,target_id,details_json)
      VALUES(?,?,?,?,?,?)`, [crypto.randomUUID(),context.clock.now(),input.actor.id,"environment.created",
      input.manifest.id,JSON.stringify({ image: input.manifest.rootOrImageDigest, available: input.manifest.available })]);
    if (input.receipt) await tx.run(`INSERT INTO idempotency_results(actor_id,key,route,request_digest,status,response_json,created_at)
      VALUES(?,?,'environment-create',?,200,?,?)`,[input.actor.id,input.receipt.key,input.receipt.digest,
      JSON.stringify(input.manifest),context.clock.now()]);
    return input.manifest;
  });
}
export async function changeEnvironment(context: ModuleContext, input: {
  readonly id: Id; readonly expectedVersion: number; readonly action: "default" | "retire"; readonly actor: EnvironmentActor;
}) {
  await context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    await requireOperator({...context,db:tx},input.actor);
    await tx.lock("quire:environments");
    // Default selection never rewrites a stored project pin.
    const record = await environmentRecord({ db: tx }, input.id);
    const changed = [record];
    if (record.version !== input.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "Environment changed; refresh before confirming");
    switch (input.action) {
      case "default": {
        await resolveEnvironment({ ...context, db: tx }, input.id);
        const previous = await tx.get<{id:string}>("SELECT id FROM environments WHERE is_default=1 AND id<>?",[input.id]);
        if (previous) changed.push(await environmentRecord({db:tx},IdSchema.parse(previous.id)));
        await tx.run("UPDATE environments SET is_default=0 WHERE is_default=1");
        await tx.run("UPDATE environments SET is_default=1 WHERE id=?", [input.id]);
        break;
      }
      case "retire": {
        const projects = await tx.all<{ settings_json: string }>("SELECT settings_json FROM projects WHERE deleted_at IS NULL");
        const pinned = projects.some(project => CompileSettingsSchema.parse(JSON.parse(project.settings_json)).environmentId === input.id);
        const active = await tx.get("SELECT id FROM compile_jobs WHERE environment_id=? AND status IN ('queued','running') LIMIT 1", [input.id]);
        if (record.isDefault || pinned || active) throw new ServiceError("ENVIRONMENT_PINNED", 409, "Default, project-pinned or active-job environments cannot be retired");
        if (record.retiredAt) throw new ServiceError("ENVIRONMENT_RETIRED", 409, "Environment is already retired");
        await tx.run("UPDATE environments SET retired_at=?,available=0 WHERE id=?", [context.clock.now(),input.id]);
        break;
      }
      default: assertNever(input.action);
    }
    for (const updated of changed) {
      await tx.run(`INSERT INTO environment_receipts(environment_id,version,report_json,manifest_digest,created_by)
        VALUES(?,1,'{}',?,?) ON CONFLICT(environment_id) DO UPDATE SET version=environment_receipts.version+1`,
        [updated.manifest.id,digest(JSON.stringify(ManifestInputSchema.parse(updated.manifest))),input.actor.id]);
    }
    await tx.run(`INSERT INTO audit_entries(id,at,actor_id,event,target_id,details_json) VALUES(?,?,?,?,?,?)`,
      [crypto.randomUUID(),context.clock.now(),input.actor.id,`environment.${input.action}`,input.id,
      JSON.stringify({ version: record.version + 1 })]);
  });
  return { ok: true, version: input.expectedVersion+1 } as const;
}
