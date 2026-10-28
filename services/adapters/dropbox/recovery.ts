import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { AdapterDefinition, AdapterServices } from "../shared";
import { journal } from "./journal";
import { freshGrant } from "./authorization";

export async function recoverDropbox(services: AdapterServices, definition: AdapterDefinition) {
  const { context } = services;
  const pending = await context.db.query(`SELECT j.*,g.owner_id,g.version,g.state
    FROM dropbox_journal j JOIN provider_grants g ON g.id=j.grant_id ORDER BY j.grant_id,j.project_id`, [],
  z.object({ grant_id: IdSchema, project_id: IdSchema, owner_id: IdSchema,
    version: z.number(), state: z.string(), payload_json: z.string() }));
  const failures: { readonly grantId: string; readonly projectId: string; readonly code: string }[] = [];
  for (const row of pending) {
    const saved = journal.parse(JSON.parse(row.payload_json));
    const cursor = await context.db.get<{ cursor: string | null }>(
      "SELECT cursor FROM adapter_cursors WHERE grant_id=? AND action=? AND project_id=?",
      [row.grant_id, saved.action, row.project_id]);
    try {
      const grant = await freshGrant(services, { actorId: row.owner_id, grantId: row.grant_id, projectId: row.project_id });
      await context.admission.background(() => services.operations.execute(definition, {
        actorId: row.owner_id, grantId: row.grant_id, projectId: row.project_id, expectedVersion: grant.version,
        expectedCursor: cursor?.cursor ?? null, action: saved.action, key: crypto.randomUUID(),
        parameters: { generatedOutput: saved.parameters.generatedOutput,
          ...(saved.parameters.branch === undefined ? {} : { branch: saved.parameters.branch }) },
      }));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const code = "code" in error && typeof error.code === "string" ? error.code : "DROPBOX_RECOVERY_FAILED";
      failures.push({ grantId: row.grant_id, projectId: row.project_id, code });
    }
  }
  return failures;
}
