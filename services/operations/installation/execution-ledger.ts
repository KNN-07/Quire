import { z } from "zod";
import { DigestSchema, IdSchema } from "@quire/contracts";
import { ExecutionIdentitySchema } from "./model";
import { controlDigest } from "./protocol";

export const supervisorMigration = {
  id: "002-supervisor-executions",
  sql: `
CREATE TABLE execution_launches (
  id TEXT PRIMARY KEY,
  parent_execution_id TEXT NOT NULL REFERENCES executions(id),
  request_id TEXT NOT NULL,
  unit TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  UNIQUE(parent_execution_id,request_id)
) STRICT;
CREATE TABLE prepared_health_failures (
  execution_id TEXT PRIMARY KEY REFERENCES executions(id),
  record_json TEXT NOT NULL CHECK(json_valid(record_json))
) STRICT;
CREATE TABLE prepared_failure_reports (
  execution_id TEXT PRIMARY KEY REFERENCES executions(id),
  report_bytes TEXT NOT NULL
) STRICT;
`,
};
export const supervisorMigrationDigest = controlDigest(supervisorMigration.sql);
export const CompletedHealthFailureSchema = z.strictObject({
  failedExecutionId: IdSchema, operationId: IdSchema, supervisorEpoch: IdSchema,
  generation: z.number().int().nonnegative(), healthIntentId: IdSchema,
  bindingDigest: DigestSchema, resultBytes: z.string().min(1),
  drainedExecutions: z.array(ExecutionIdentitySchema).min(1).readonly(),
  stopEvidenceDigest: DigestSchema, stopEvidenceBytes: z.string().min(1),
}).readonly();
export type CompletedHealthFailure = z.infer<typeof CompletedHealthFailureSchema>;
export const PreparedFailureReportSchema = z.strictObject({
  stage: z.enum(["construction", "check"]), code: z.string().min(1).max(128),
  detail: z.string().max(8192), bindingDigest: DigestSchema,
}).readonly();
export type PreparedFailureReport = z.infer<typeof PreparedFailureReportSchema>;
