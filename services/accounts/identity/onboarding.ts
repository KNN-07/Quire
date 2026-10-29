import { z } from "zod";
import { endpoints, OnboardingChoicesSchema, OnboardingSchema, ProjectSchema, resourceVersionTag } from "@quire/contracts";
import type { Id, Onboarding, OnboardingImportState, SqlExecutor, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import type { IdentityDependencies } from "./credentials";
import { hash, newId } from "./store";

async function read(db: SqlExecutor, actorId: Id): Promise<Onboarding> {
  const row = await db.get("SELECT value_json,version FROM identity_onboarding WHERE user_id=?", [actorId]);
  if (!row) return {
    schemaVersion: 1, actorId, version: 0, stage: "choosing", createKey: null, projectId: null, importState: null,
    choices: { writingKind: "paper", name: "My first paper", origin: { kind: "blank" }, defaultView: "split" },
  };
  const saved = z.object({ value_json: z.string(), version: z.number() }).parse(row);
  const progress = OnboardingSchema.parse({ ...OnboardingSchema.parse(JSON.parse(saved.value_json)), actorId, version: saved.version });
  return progress.stage === "import" && !progress.importState
    ? { ...progress, importState: initialImport(progress.choices.name) } : progress;
}
function initialImport(name: string): OnboardingImportState {
  return { draft: { mode: "upload", name, workspaceId: null, url: "", branch: "main", grantId: null }, attempt: null };
}
export { read as readOnboarding };
export async function writeOnboarding(context: ModuleContext, tx: Transaction, progress: Onboarding): Promise<Onboarding> {
  await tx.run(`INSERT INTO identity_onboarding(user_id,value_json,version,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET value_json=excluded.value_json,version=excluded.version,updated_at=excluded.updated_at`,
  [progress.actorId, JSON.stringify(progress), progress.version, context.clock.now()]);
  return progress;
}

export function registerOnboarding(context: ModuleContext, { auth, repository }: IdentityDependencies): void {
  context.routes.register(endpoints.onboardingGet, async (_input, request) => {
    const principal = await auth.port.require(request.request);
    request.responseHeaders.set("cache-control", "private, no-store");
    const progress = await read(context.db, principal.user.id);
    request.responseHeaders.set("etag", resourceVersionTag(progress.version));
    return progress;
  });
  for (const endpoint of [endpoints.onboardingSave, endpoints.onboardingStart, endpoints.onboardingComplete]) {
    context.routes.register(endpoint, async ({ body }, request) => {
      const principal = await auth.mutation(request.request);
      // Queued writes from a previous login must never become another actor's draft.
      if (body.actorId !== principal.user.id) throw new ServiceError("SESSION_CHANGED", 409, "Account changed; reload onboarding");
      const result = await context.uow.run(async tx => {
        await tx.lock("quire:accounts");
        await repository.find(principal.user.id, tx);
        return repository.idempotent(tx, {
          actor: principal.user.id, route: `${endpoint.method}:${endpoint.path}`,
          key: request.request.headers.get("idempotency-key") ?? "", body, schema: OnboardingSchema,
        }, async () => {
          const current = await read(tx, principal.user.id);
          if (current.version !== body.expectedVersion) throw new ServiceError("VERSION_CONFLICT", 409, "Onboarding changed; reload saved choices");
          let next: Onboarding;
          if ("choices" in body) {
            if (current.stage !== "choosing") throw new ServiceError("ONBOARDING_STARTED", 409, "Starting point is frozen; resume the existing project");
            next = { ...current, choices: OnboardingChoicesSchema.parse(body.choices) };
          } else if (endpoint === endpoints.onboardingStart) {
            if (current.stage !== "choosing") return current;
            if (!current.choices.name.trim()) throw new ServiceError("PROJECT_NAME_REQUIRED", 422, "Enter a project name");
            next = { ...current, stage: current.choices.origin.kind === "import" ? "import" : "creating",
              createKey: current.choices.origin.kind === "import" ? null : newId(),
              importState: current.choices.origin.kind === "import" ? initialImport(current.choices.name) : null };
          } else {
            if (current.stage === "complete") return current;
            if (current.stage !== "creating" || !current.createKey || current.choices.origin.kind === "import") {
              throw new ServiceError("PROJECT_PENDING", 409, "Create the saved starting point first");
            }
            // Consume the existing writer's durable HTTP receipt, never invent a project
            // or accept a client-supplied ID as evidence of completion.
            const receipt = await tx.get("SELECT request_digest,response_json FROM idempotency_results WHERE actor_id=? AND route='projectCreate' AND key=?",
              [principal.user.id, current.createKey]);
            if (!receipt) throw new ServiceError("PROJECT_PENDING", 409, "Project creation has not finished; resume it");
            const saved = z.object({ request_digest: z.string(), response_json: z.string() }).parse(receipt);
            const digest = hash(JSON.stringify({ name: current.choices.name, origin: current.choices.origin }));
            if (saved.request_digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409, "Project request differs from saved choices");
            const { data: project } = z.object({ data: ProjectSchema }).parse(JSON.parse(saved.response_json));
            if (project.ownerId !== principal.user.id) throw new ServiceError("FORBIDDEN", 403, "Project belongs to another account");
            next = { ...current, stage: "complete", projectId: project.id };
          }
          next = { ...next, version: current.version + 1 };
          return writeOnboarding(context, tx, next);
        });
      });
      request.responseHeaders.set("cache-control", "private, no-store");
      request.responseHeaders.set("etag", resourceVersionTag(result.version));
      return result;
    });
  }
}
