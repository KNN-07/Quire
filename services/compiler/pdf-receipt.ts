import { createHmac, timingSafeEqual } from "node:crypto";
import type { Id } from "@quire/contracts";

export type PdfValidationIdentity = {
  readonly jobId: Id; readonly attempt: number; readonly fencingToken: number;
  readonly environmentId: Id; readonly imageDigest: string;
  readonly name: string; readonly digest: string;
};

/** Issued by the trusted worker process only after confined pdftoppm succeeds.
 * The sandbox never receives the worker bearer or the job capability. */
export function pdfValidationReceipt(bearer: string, input: PdfValidationIdentity): string {
  return createHmac("sha256", bearer).update(JSON.stringify([
    "quire:pdf-validation:pdftoppm:v1", input.jobId, input.attempt, input.fencingToken,
    input.environmentId, input.imageDigest, input.name, input.digest,
  ])).digest("hex");
}

export function validPdfReceipt(bearer: string, input: PdfValidationIdentity, supplied: string | null): boolean {
  if (!supplied || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(pdfValidationReceipt(bearer, input), "hex"));
}
