import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { CoreProjects, downloadOperation } from "../../core/base";
import { delegatedExport } from "../../core/base/export-adapter";
import { defineAction } from "../shared";
import type { AdapterContribution } from "../shared";
import { PublisherClient } from "./client";
import {
  parsePublisherContract,
  publisherOAuth,
  publisherRequirements,
} from "./configuration";
import { readSubmission } from "./store";

const PrepareSchema = z.strictObject({
  snapshotId: IdSchema.optional(),
}).readonly();
const SubmitSchema = z.strictObject({
  preparationId: IdSchema,
  confirmation: z.literal(true),
  manualSubmissionId: z.string().min(1).optional(),
  manualReceipt: z.string().min(1).optional(),
}).readonly();
const StatusSchema = z.strictObject({
  preparationId: IdSchema,
}).readonly();

export const publisherContribution: AdapterContribution = (services) => {
  const client = new PublisherClient(services);
  const projects = new CoreProjects(services.context);
  return {
    kind: "publisher",
    label: "Configured publisher destination",
    configuration: publisherRequirements,
    oauth: publisherOAuth,
    actions: {
      prepare: defineAction(PrepareSchema, {
        projectAccess: "read",
        async prepare(parameters, context) {
          if (!context.projectId) {
            throw new ServiceError("PROJECT_REQUIRED", 400, "Publisher preparation requires a project");
          }
          const projectId = context.projectId;
          const contract = parsePublisherContract(context.configuration);
          const archive = await delegatedExport(services.context, {
            actorId: context.actorId,
            projectId,
            ...(parameters.snapshotId ? { snapshotId: parameters.snapshotId } : {}),
            kind: "submission",
            key: `publisher-archive:${context.key}`,
          });
          const bytes = await downloadOperation(projects, context.actorId, { id: archive.id });
          const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
          const preparationId = IdSchema.parse(crypto.randomUUID());
          return {
            result: {
              preparationId,
              archiveOperationId: archive.id,
              archiveSha256: digest,
              destinationMode: contract.mode,
              support: { prepare: true, manual: contract.mode === "manual", direct: contract.mode === "direct" },
              state: "prepared",
            },
            cursor: null,
            async publish(tx) {
              await tx.run(
                `INSERT INTO publisher_submissions
                (id,actor_id,grant_id,project_id,archive_operation_id,archive_sha256,destination_mode,state,
                 config_version,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,'prepared',?,?,?)`,
                [
                  preparationId,
                  context.actorId,
                  context.grant.id,
                  projectId,
                  archive.id,
                  digest,
                  contract.mode,
                  context.configuration.version,
                  services.context.clock.now(),
                  services.context.clock.now(),
                ],
              );
            },
          };
        },
      }),
      submit: defineAction(SubmitSchema, {
        projectAccess: "write",
        async prepare(parameters, context) {
          if (!context.projectId) {
            throw new ServiceError("PROJECT_REQUIRED", 400, "Publisher submission requires a project");
          }
          const projectId = context.projectId;
          const contract = parsePublisherContract(context.configuration);
          const stored = await readSubmission(services.context.db, {
            id: parameters.preparationId,
            actorId: context.actorId,
            grantId: context.grant.id,
            projectId,
          });
          if (stored.config_version !== context.configuration.version || stored.destination_mode !== contract.mode) {
            throw new ServiceError(
              "PUBLISHER_CONTRACT_CHANGED",
              409,
              "Publisher destination contract changed after preparation",
            );
          }
          if (stored.state !== "prepared") {
            throw new ServiceError("PUBLISHER_ALREADY_SUBMITTED", 409, "Publisher preparation already has a receipt");
          }
          const submitted = contract.mode === "manual"
            ? (() => {
                if (!parameters.manualSubmissionId || !parameters.manualReceipt) {
                  throw new ServiceError(
                    "PUBLISHER_MANUAL_RECEIPT_REQUIRED",
                    422,
                    "Manual submission requires the destination submission ID and provider receipt",
                  );
                }
                return {
                  submissionId: parameters.manualSubmissionId,
                  status: "submitted-manually",
                  receipt: parameters.manualReceipt,
                };
              })()
            : await client.submit({
                context,
                contract,
                archive: await downloadOperation(projects, context.actorId, {
                  id: stored.archive_operation_id,
                }),
                archiveSha256: stored.archive_sha256,
              });
          return {
            result: {
              preparationId: stored.id,
              submissionId: submitted.submissionId,
              providerStatus: submitted.status,
              receipt: submitted.receipt,
              destinationMode: contract.mode,
              state: "submitted",
            },
            cursor: null,
            async publish(tx) {
              const current = await readSubmission(tx, {
                id: stored.id,
                actorId: context.actorId,
                grantId: context.grant.id,
                projectId,
              });
              if (current.state !== "prepared") {
                throw new ServiceError("PUBLISHER_ALREADY_SUBMITTED", 409, "Publisher preparation already has a receipt");
              }
              await tx.run(
                `UPDATE publisher_submissions
                 SET state='submitted',remote_submission_id=?,provider_status=?,receipt=?,submitted_at=?,updated_at=?
                 WHERE id=?`,
                [
                  submitted.submissionId,
                  submitted.status,
                  submitted.receipt,
                  services.context.clock.now(),
                  services.context.clock.now(),
                  stored.id,
                ],
              );
            },
          };
        },
      }),
      status: defineAction(StatusSchema, {
        projectAccess: "read",
        async prepare(parameters, context) {
          if (!context.projectId) {
            throw new ServiceError("PROJECT_REQUIRED", 400, "Publisher status requires a project");
          }
          const projectId = context.projectId;
          const contract = parsePublisherContract(context.configuration);
          const stored = await readSubmission(services.context.db, {
            id: parameters.preparationId,
            actorId: context.actorId,
            grantId: context.grant.id,
            projectId,
          });
          if (stored.config_version !== context.configuration.version || stored.destination_mode !== contract.mode) {
            throw new ServiceError(
              "PUBLISHER_CONTRACT_CHANGED",
              409,
              "Publisher destination contract changed after preparation",
            );
          }
          if (contract.mode === "manual" || stored.remote_submission_id === null) {
            return {
              result: {
                preparationId: stored.id,
                submissionId: stored.remote_submission_id,
                providerStatus: stored.provider_status,
                receipt: stored.receipt,
                destinationMode: contract.mode,
                state: stored.state,
              },
              cursor: null,
            };
          }
          const latest = await client.status({
            context,
            contract,
            submissionId: stored.remote_submission_id,
          });
          return {
            result: {
              preparationId: stored.id,
              submissionId: latest.submissionId,
              providerStatus: latest.status,
              receipt: latest.receipt,
              destinationMode: contract.mode,
              state: stored.state,
            },
            cursor: null,
            async publish(tx) {
              await readSubmission(tx, {
                id: stored.id,
                actorId: context.actorId,
                grantId: context.grant.id,
                projectId,
              });
              await tx.run(
                "UPDATE publisher_submissions SET provider_status=?,receipt=?,updated_at=? WHERE id=?",
                [latest.status, latest.receipt, services.context.clock.now(), stored.id],
              );
            },
          };
        },
      }),
    },
    async test(context) {
      const contract = parsePublisherContract(context.configuration);
      await client.test(
        {
          ...context,
          expectedCursor: null,
          key: "publisher-connection-test",
        },
        contract,
      );
      return { ok: true };
    },
  };
};
