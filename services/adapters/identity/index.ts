import type { ServiceModule } from "@quire/runtime";
import { SafeHttpClient } from "../shared";
import { identityProfiles } from "./providers";
import type { IdentityProfile } from "./providers";
import { oauthIdentityProvider } from "./oauth";
import { registerIdentityProvider, registerIdentityRoutes } from "./registry";
import { registerIdentityUnlink } from "./unlink";
import { migrations } from "./migrations";

export function createIdentityModule(options: {
  readonly http?: SafeHttpClient;
  /** Explicit assembly-only profiles permit isolated protocol servers; never read from HTTP input. */
  readonly profiles?: readonly IdentityProfile[];
} = {}): ServiceModule {
  return {
    id: "062-a-external-identity", lane: "A", order: 62, migrations,
    register(context) {
      const http = options.http ?? new SafeHttpClient();
      for (const profile of options.profiles ?? identityProfiles) {
        registerIdentityProvider(context, oauthIdentityProvider(context, profile, http));
      }
      registerIdentityRoutes(context);
      registerIdentityUnlink(context);
    },
  };
}
export { createExternalIdentityAdmission } from "./admission";
export type { ExternalIdentityVerification } from "./admission";
export { identityContributions, identityProfiles, identityDefinition } from "./providers";
export type { IdentityProfile } from "./providers";
export { registerIdentityProvider } from "./registry";
export type { IdentityProvider } from "./registry";
export { migrations } from "./migrations";
