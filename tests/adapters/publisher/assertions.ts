import { z } from "zod";
import type { AdapterGrant } from "@quire/contracts";
import {
  type PublisherFixture,
  type Session,
} from "./harness";

export const ErrorEnvelope = z.object({
  error: z.object({ code: z.string() }),
});
export const PrepareResultSchema = z.object({
  preparationId: z.uuid(),
  archiveOperationId: z.uuid(),
  archiveSha256: z.string().length(64),
  destinationMode: z.enum(["manual", "direct"]),
  support: z.object({
    prepare: z.boolean(),
    manual: z.boolean(),
    direct: z.boolean(),
  }),
  state: z.literal("prepared"),
});
export const SubmitResultSchema = z.object({
  preparationId: z.uuid(),
  submissionId: z.string(),
  providerStatus: z.string(),
  receipt: z.string(),
  destinationMode: z.enum(["manual", "direct"]),
  state: z.literal("submitted"),
});
export type PrepareResult = z.infer<typeof PrepareResultSchema>;
export type SubmitResult = z.infer<typeof SubmitResultSchema>;

export async function prepareSubmission(input: {
  readonly fixture: PublisherFixture;
  readonly owner: Session;
  readonly grant: AdapterGrant;
  readonly projectId: string;
  readonly key: string;
}) {
  const response = await input.fixture.action({
    session: input.owner,
    grantId: input.grant.id,
    grantVersion: input.grant.version,
    projectId: input.projectId,
    action: "prepare",
    parameters: {},
    key: input.key,
  });
  return PrepareResultSchema.parse((await input.fixture.operation(response)).result);
}
