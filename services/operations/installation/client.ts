import { lstat, readFile, realpath } from "node:fs/promises";
import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { systemClock } from "@quire/runtime";
import { createUpdateClient } from "../updates/client";
import { ControlError } from "./model";
import { createUnixUpdateTransport } from "./controller-server";
import type { ControlCredential } from "./protocol";

export async function privateInstallationFile(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 ||
      info.size > 1_048_576 || await realpath(path) !== path) {
    throw new ControlError("CONTROL_SECRET_UNSAFE", path);
  }
  return readFile(path);
}
export const CredentialFileSchema = z.strictObject({
  id: IdSchema, installationId: z.string().min(1), channel: z.enum(["api", "operator"]),
  secret: z.string().regex(/^[0-9a-f]{64}$/),
});
export async function installationCredential(path: string): Promise<ControlCredential> {
  const input: unknown = JSON.parse((await privateInstallationFile(path)).toString("utf8"));
  const value = CredentialFileSchema.parse(input);
  return { ...value, secret: Buffer.from(value.secret, "hex") };
}
export async function installationUpdateClient(socketPath: string, credentialPath: string, installationId: string) {
  const credential = await installationCredential(credentialPath);
  if (credential.channel !== "api" || credential.installationId !== installationId) {
    throw new ControlError("CONTROL_CREDENTIAL_INVALID");
  }
  return createUpdateClient(credential, systemClock, createUnixUpdateTransport(socketPath));
}
