import { z } from "zod";
import type { ControlledRoleSession } from "./controller-server";
import { ControlError } from "./model";
import { canonicalJson, controlDigest } from "./protocol";
import { PreparedFailureReportSchema } from "./execution-ledger";
import type { PreparedFailureReport } from "./execution-ledger";

export const PreparedFailureResponseSchema = z.strictObject({
  kind: z.literal("prepared-health-failure"), reportDigest: z.string().regex(/^[0-9a-f]{64}$/),
});
export async function reportPreparedFailure(session: ControlledRoleSession,
  stage: PreparedFailureReport["stage"], error: unknown) {
  if (session.permit.execution.purpose !== "prepared") throw error;
  const code = z.object({ code: z.string().min(1).max(128) }).safeParse(error).data?.code ?? "CONTROL_CANDIDATE_HEALTH_FAILED";
  const report = PreparedFailureReportSchema.parse({
    stage, code, detail: (error instanceof Error ? error.message : String(error)).slice(0, 8192),
    bindingDigest: controlDigest(canonicalJson(session.permit.binding)),
  });
  const bytes = canonicalJson(report);
  const acknowledged = z.object({ reportDigest: z.string() }).parse(
    await session.channel.request("prepared.failure", { token: session.permit.token, report }));
  if (acknowledged.reportDigest !== controlDigest(bytes)) throw new ControlError("CONTROL_HEALTH_REPORT_MISMATCH");
  return { kind: "prepared-health-failure" as const, reportDigest: acknowledged.reportDigest };
}
