import type { Id } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { ConfiguredAdapter } from "../shared";
import type { AdapterServices } from "../shared";
import { DropboxPolicies } from "./policy";

export async function freshGrant(services: AdapterServices, input: {
  readonly actorId: Id; readonly grantId: Id; readonly projectId: Id;
}) {
  await new DropboxPolicies(services.context).assert(input.actorId, input.projectId);
  const grant = await services.grants.read(input.actorId, input.grantId);
  if (grant.expiresAt && grant.expiresAt <= services.context.clock.now()) {
    const adapter = services.context.services.get("adapters").get("dropbox");
    if (!(adapter instanceof ConfiguredAdapter)) {
      throw new ServiceError("DROPBOX_REFRESH_CONTRACT_MISSING", 503, "ConfiguredAdapter OAuth refresh contract required");
    }
    await adapter.refresh({ actorId: input.actorId, grantId: input.grantId, expectedVersion: grant.version });
    return services.grants.read(input.actorId, input.grantId);
  }
  return grant;
}
