import { z } from "zod";
import type { AdapterServices, GrantContext } from "../shared";
import { RepositorySummarySchema } from "./types";
import { apiBase } from "./provider-client";
import type { ProviderClient } from "./provider-client";

const repositorySchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  path_with_namespace: z.string(),
  default_branch: z.string().nullable(),
  http_url_to_repo: z.url(),
  visibility: z.string(),
  last_activity_at: z.string().nullable(),
});

function headers(context: GrantContext) {
  return { authorization: `Bearer ${context.tokens.accessToken}` };
}

export function gitlabClient(services: AdapterServices): ProviderClient {
  return {
    async list(context, limit, cursor) {
      const page = cursor === null ? 1 : z.coerce.number().int().positive().parse(cursor);
      const rows = await services.http.json(
        `${apiBase("gitlab", context.configuration)}/projects?membership=true&simple=true&order_by=updated_at&sort=desc&per_page=${limit}&page=${page}`,
        z.array(repositorySchema),
        { headers: headers(context), signal: context.signal },
      );
      return {
        repositories: rows.map((row) => RepositorySummarySchema.parse({
          id: String(row.id),
          name: row.name,
          fullName: row.path_with_namespace,
          defaultBranch: row.default_branch ?? "main",
          cloneUrl: row.http_url_to_repo,
          private: row.visibility !== "public",
          updatedAt: row.last_activity_at,
        })),
        cursor: rows.length === limit ? String(page + 1) : null,
      };
    },
    async create(context, input) {
      const row = await services.http.json(
        `${apiBase("gitlab", context.configuration)}/projects`,
        repositorySchema,
        {
          method: "POST",
          headers: {
            ...headers(context),
            "content-type": "application/json",
            "idempotency-key": context.key,
          },
          body: JSON.stringify({
            name: input.name,
            path: input.name,
            visibility: input.private ? "private" : "public",
            ...(input.namespace ? { namespace_id: input.namespace } : {}),
          }),
          signal: context.signal,
        },
      );
      return {
        id: String(row.id),
        url: row.http_url_to_repo,
        fullName: row.path_with_namespace,
        defaultBranch: row.default_branch ?? "main",
      };
    },
    async test(context) {
      await services.http.json(
        `${apiBase("gitlab", context.configuration)}/user`,
        z.object({ id: z.number().int(), username: z.string() }),
        { headers: headers(context), signal: context.signal },
      );
    },
  };
}
