import { z } from "zod";
import { endpoints } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import type { AdapterServices } from "../shared";
import { actor } from "../../core/base/http";
import { RemoteRepository } from "./git-process";
import type { RemoteGitOptions } from "./git-process";

const savedCredentials = z.strictObject({
  repositoryUrl: z.url(), username: z.string().min(1), password: z.string().min(1),
});
export function genericCredentials(accessToken: string) {
  return savedCredentials.parse(JSON.parse(accessToken));
}
export function registerGenericCredentials(context: ModuleContext, services: AdapterServices, options: RemoteGitOptions): void {
  context.routes.register(endpoints.gitCredentials, async (input, request) => {
    const actorId = await actor(context, request);
    const settings = await services.configuration.get("git");
    if (!settings.enabled || settings.version === 0 || Bun.which("git") === null) {
      throw new ServiceError("PROVIDER_UNCONFIGURED", 503, "Enable the generic Git provider and install Git");
    }
    const credentials = {
      repositoryUrl: new URL(input.body.url).href, username: input.body.username, password: input.body.secret,
    };
    await using remote = await RemoteRepository.open({ url: credentials.repositoryUrl, credentials, options });
    await remote.branches();
    return context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const current = await services.configuration.get("git", tx);
      if (!current.enabled || current.version !== settings.version) {
        throw new ServiceError("PROVIDER_CHANGED", 409, "Generic Git configuration changed");
      }
      await services.grants.activeActor(actorId, tx);
      return services.grants.create({
        actorId, provider: "git", label: input.body.label,
        tokens: { accessToken: JSON.stringify(credentials), refreshToken: null, tokenType: "Basic",
          scopes: ["repository.read"], expiresAt: null },
      }, tx);
    });
  });
}
