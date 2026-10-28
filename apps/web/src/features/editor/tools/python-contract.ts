import { z } from "zod";
import { ProjectPathSchema } from "@quire/contracts";

export const PythonInstallationSchema = z.strictObject({
  enabled: z.boolean(), indexURL: z.string().url(), version: z.string().min(1),
});
export const PythonRunSchema = z.strictObject({
  id: z.string().uuid(), installation: PythonInstallationSchema,
  source: z.string(), inputs: z.array(z.strictObject({ path: ProjectPathSchema, bytes: z.instanceof(Uint8Array) })),
});
export const PythonResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("complete"), id: z.string().uuid(), version: z.string(), stdout: z.array(z.string()),
    files: z.array(z.strictObject({ path: ProjectPathSchema, bytes: z.instanceof(Uint8Array) })) }),
  z.strictObject({ kind: z.literal("error"), id: z.string().uuid(), message: z.string() }),
]);
export type PythonInstallation = z.infer<typeof PythonInstallationSchema>;
export type PythonResult = z.infer<typeof PythonResultSchema>;

export class PythonExecutionError extends Error {
  constructor(readonly code: "CONFIGURATION" | "RUNTIME" | "CANCELED" | "TIMEOUT", message: string) {
    super(message); this.name = "PythonExecutionError";
  }
}
