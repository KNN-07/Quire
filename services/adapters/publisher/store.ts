import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id, SqlExecutor } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";

const SubmissionRowSchema = z.object({
  id: IdSchema,
  actor_id: IdSchema,
  grant_id: IdSchema,
  project_id: IdSchema,
  archive_operation_id: IdSchema,
  archive_sha256: z.string().length(64),
  destination_mode: z.enum(["manual", "direct"]),
  state: z.enum(["prepared", "submitted"]),
  remote_submission_id: z.string().nullable(),
  provider_status: z.string().nullable(),
  receipt: z.string().nullable(),
  config_version: z.number().int().positive(),
  submitted_at: z.string().nullable(),
  updated_at: z.string(),
});
export type SubmissionRow = z.infer<typeof SubmissionRowSchema>;

export async function readSubmission(executor: SqlExecutor, input: {
  readonly id: Id;
  readonly actorId: Id;
  readonly grantId: Id;
  readonly projectId: Id;
}): Promise<SubmissionRow> {
  const row = await executor.get(
    `SELECT id,actor_id,grant_id,project_id,archive_operation_id,archive_sha256,destination_mode,state,
      remote_submission_id,provider_status,receipt,config_version,submitted_at,updated_at
     FROM publisher_submissions WHERE id=?`,
    [input.id],
  );
  const submission = SubmissionRowSchema.parse(row);
  if (
    submission.actor_id !== input.actorId ||
    submission.grant_id !== input.grantId ||
    submission.project_id !== input.projectId
  ) {
    throw new ServiceError("PUBLISHER_SUBMISSION_NOT_FOUND", 404, "Publisher preparation not found");
  }
  return submission;
}
