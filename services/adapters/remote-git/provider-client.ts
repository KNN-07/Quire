import type { z } from "zod";
import type {
  ActionContext,
  GrantContext,
  ProviderSettings,
} from "../shared";
import type { RepositorySummarySchema } from "./types";
import type { RemoteProvider } from "./types";
import type { ExportRemote } from "./export-new";

export type ProviderClient = {
  readonly list: (context: GrantContext, limit: number, cursor: string | null) => Promise<{
    readonly repositories: readonly z.infer<typeof RepositorySummarySchema>[];
    readonly cursor: string | null;
  }>;
  readonly create: (context: ActionContext, input: ExportRemote) => Promise<{
    readonly id: string;
    readonly url: string;
    readonly fullName: string;
    readonly defaultBranch: string;
  }>;
  readonly test: (context: GrantContext) => Promise<void>;
  readonly revoke?: (context: GrantContext) => Promise<void>;
};

export function apiBase(provider: RemoteProvider, settings: ProviderSettings): string {
  const base = new URL(settings.baseUrl);
  if (provider === "github") {
    return base.hostname === "github.com"
      ? "https://api.github.com"
      : new URL("/api/v3", base).href.replace(/\/$/, "");
  }
  if (provider === "gitlab") {
    return new URL("/api/v4", base).href.replace(/\/$/, "");
  }
  return base.href.replace(/\/$/, "");
}

export function gitCredentials(provider: RemoteProvider, context: GrantContext) {
  return {
    username: provider === "github" ? "x-access-token" : provider === "gitlab" ? "oauth2" : "git",
    password: context.tokens.accessToken,
  };
}
