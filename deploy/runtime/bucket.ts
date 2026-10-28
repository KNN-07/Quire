import { z } from "zod";
import { checked } from "./artifacts";

/** Signed bucket creation, not an anonymous fake S3 readiness response. */
export async function provisionBucket(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = z.object({
    endpoint: z.url(), bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    accessKeyId: z.string().min(1), secretAccessKey: z.string().min(1), region: z.string().min(1),
  }).parse({
    endpoint: env["QUIRE_S3_ENDPOINT"], bucket: env["QUIRE_S3_BUCKET"],
    accessKeyId: env["QUIRE_S3_ACCESS_KEY_ID"], secretAccessKey: env["QUIRE_S3_SECRET_ACCESS_KEY"],
    region: env["QUIRE_S3_REGION"],
  });
  // Bun 1.3.14's S3Client intentionally rejects empty object keys; curl signs
  // the actual bucket-level request without inventing an object-key workaround.
  const response = await checked(["curl", "--silent", "--show-error", "--max-time", "10",
    "--aws-sigv4", `aws:amz:${config.region}:s3`, "--user", `${config.accessKeyId}:${config.secretAccessKey}`,
    "--request", "PUT", "--write-out", "\n%{http_code}", `${config.endpoint.replace(/\/$/, "")}/${config.bucket}`]);
  const status = Number(response.slice(response.lastIndexOf("\n") + 1));
  if (status !== 200 && !(status === 409 && response.includes("BucketAlreadyOwnedByYou"))) {
    throw new BucketError(status);
  }
}
class BucketError extends Error {
  constructor(readonly status: number) { super(`BUCKET_PROVISION_FAILED: ${status}`); }
}
if (import.meta.main) await provisionBucket();
