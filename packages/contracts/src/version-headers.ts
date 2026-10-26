import { z } from "zod";
import { CountSchema } from "./primitives";

export const ResourceVersionTagSchema = z.string().regex(/^"v(0|[1-9]\d*)"$/)
  .transform((value) => Number(value.slice(2, -1))).pipe(CountSchema);
export function resourceVersionTag(version: number): string {
  return `"v${CountSchema.parse(version)}"`;
}
export function parseResourceVersionTag(value: string | null): number | null {
  const result = ResourceVersionTagSchema.safeParse(value);
  return result.success ? result.data : null;
}
