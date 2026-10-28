import { z } from "zod";
import { endpoints } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext, ServiceModule } from "@quire/runtime";
import { ControlError } from "../installation/model";
import type { UpdateClient } from "./client";
import { reserveUpdateCommand } from "./commands";
import { UpdateError } from "./model";
import { migrations } from "./migrations";

export { migrations } from "./migrations";
export { UpdateService } from "./service";
export type { UpdateOptions } from "./service";
export type { UpdateClient, ReservedUpdateCommand, UpdateOperationRow, UpdateOperationQuery } from "./client";
export { createUpdateClient } from "./client";
export type { UpdateTransport } from "./client";
export { reserveUpdateCommand, reconcileCommandKeys } from "./commands";
export { ApplicationLegacySource, importLegacyUpdates } from "./legacy-import";
export { UpdateConfig, UpdateError, ReportedUpdateFailure } from "./model";
export type { SignedRelease, BackupReceipt } from "./model";
export { OwnedInstaller } from "./installer";
export { startScheduler, systemUpdateTimer } from "./scheduler";
export type { UpdateTimer } from "./scheduler";

async function translate<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof UpdateError || error instanceof ControlError) throw new ServiceError(error.code, 409, error.message);
    throw error;
  }
}
export interface UpdateApiOptions {
  readonly installationId: string;
  readonly client: UpdateClient;
}
/** API registration holds only the command client; the controller owns scheduling. */
export function registerUpdates(context: ModuleContext, options?: UpdateApiOptions): UpdateClient | null {
  const client = options?.client ?? null;
  context.routes.register(endpoints.releasesList, async ({ query }, request) => {
    const principal = await context.services.get("identity").require(request.request);
    if (!principal.operator) throw new ServiceError("FORBIDDEN", 403, "Operator access required");
    const releases = client ? await translate(() => client.releases()) : [];
    const selected = releases.filter((release) => release.id > (query.cursor ?? "")).sort((a, b) => a.id.localeCompare(b.id));
    const items = selected.slice(0, query.limit);
    return { items, nextCursor: selected.length > query.limit ? items.at(-1)?.id ?? null : null };
  });
  context.routes.register(endpoints.updateCreate, async ({ body }, request) => {
    const identity = context.services.get("identity");
    const principal = await identity.require(request.request);
    if (!principal.operator) throw new ServiceError("FORBIDDEN", 403, "Operator access required");
    await identity.verifyMutation(request.request, principal);
    const session = z.object({ created_at: z.string() }).parse(
      await context.db.get("SELECT created_at FROM sessions WHERE id=?", [principal.sessionId]));
    if (Date.parse(context.clock.now()) - Date.parse(session.created_at) > 900_000) {
      throw new ServiceError("FRESH_AUTH_REQUIRED", 403, "Sign in again for this operation");
    }
    if (!client || !options) throw new ServiceError("UPDATES_UNCONFIGURED", 503, "Configure an independent installation controller first");
    const key = request.request.headers.get("idempotency-key");
    if (!key) throw new ServiceError("IDEMPOTENCY_KEY_REQUIRED", 400, "Idempotency-Key required");
    return translate(async () => {
      const command = await reserveUpdateCommand(context.uow, options.installationId, principal.user.id, key, body);
      return client.create(command);
    });
  });
  return client;
}
export const register = (context: ModuleContext): void => { registerUpdates(context); };
export function updateModule(options?: UpdateApiOptions): ServiceModule {
  return { id: "o-updates", lane: "O", order: 705, migrations, register: (context) => { registerUpdates(context, options); } };
}
