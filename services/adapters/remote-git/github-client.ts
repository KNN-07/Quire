import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import type { AdapterServices, GrantContext } from "../shared";
import { RepositorySummarySchema } from "./types";
import { apiBase } from "./provider-client";
import type { ProviderClient } from "./provider-client";

const repositorySchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string(),
  clone_url: z.url(),
  private: z.boolean(),
  updated_at: z.string().nullable(),
});

function headers(context: GrantContext) {
  return {
    authorization: `Bearer ${context.tokens.accessToken}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

export function githubClient(services: AdapterServices): ProviderClient {
  return {
    async list(context, limit, cursor) {
      const page = cursor === null ? 1 : z.coerce.number().int().positive().parse(cursor);
      const rows = await services.http.json(
        `${apiBase("github", context.configuration)}/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=${limit}&page=${page}`,
        z.array(repositorySchema),
        { headers: headers(context), signal: context.signal },
      );
      return {
        repositories: rows.map((row) => RepositorySummarySchema.parse({
          id: String(row.id),
          name: row.name,
          fullName: row.full_name,
          defaultBranch: row.default_branch,
          cloneUrl: row.clone_url,
          private: row.private,
          updatedAt: row.updated_at,
        })),
        cursor: rows.length === limit ? String(page + 1) : null,
      };
    },
    async create(context, input) {
      const url = input.namespace
        ? `${apiBase("github", context.configuration)}/orgs/${encodeURIComponent(input.namespace)}/repos`
        : `${apiBase("github", context.configuration)}/user/repos`;
      const row = await services.http.json(url, repositorySchema, {
        method: "POST",
        headers: {
          ...headers(context),
          "content-type": "application/json",
          "idempotency-key": context.key,
        },
        body: JSON.stringify({ name: input.name, private: input.private, auto_init: false }),
        signal: context.signal,
      });
      return {
        id: String(row.id),
        url: row.clone_url,
        fullName: row.full_name,
        defaultBranch: row.default_branch,
      };
    },
    async test(context) {
      await services.http.json(
        `${apiBase("github", context.configuration)}/user`,
        z.object({ id: z.number().int(), login: z.string() }),
        { headers: headers(context), signal: context.signal },
      );
    },
    async revoke(context) {
      const clientId = context.configuration.model;
      const clientSecret = context.configuration.secret;
      if (!clientId || !clientSecret) {
        throw new ServiceError("PROVIDER_UNCONFIGURED", 503, "Missing GitHub OAuth client ID or secret");
      }
      const response = await services.http.request(
        `${apiBase("github", context.configuration)}/applications/${encodeURIComponent(clientId)}/grant`,
        {
          method: "DELETE",
          headers: {
            authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            "x-github-api-version": "2022-11-28",
          },
          body: JSON.stringify({ access_token: context.tokens.accessToken }),
          signal: context.signal,
        },
      );
      if (response.status !== 204) {
        throw new ServiceError("PROVIDER_REVOCATION_FAILED", 502, "GitHub did not confirm grant revocation");
      }
    },
  };
}
