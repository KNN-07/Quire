import { z } from "zod";
import { EnvironmentSchema } from "@quire/contracts";
import type { Environment } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";

export const Profiles = ["default", "restricted", "knitr"] as const;
export const ProfileSchema = z.enum(Profiles);
export type Profile = z.infer<typeof ProfileSchema>;
export const profileHelpers = {
  default:["bibtex","biber","synctex"],
  restricted:["bibtex","biber","synctex","latexminted","quire-tikz"],
  knitr:["bibtex","biber","synctex","knitr"],
} as const satisfies Readonly<Record<Profile,readonly string[]>>;
export const ImageSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
// This is also the immutable projection used to hash an executed manifest.
// The HTTP endpoint independently rejects unknown request properties.
export const ManifestInputSchema = EnvironmentSchema.unwrap().omit({ available: true, probeAt: true }).strip();
export const ProbeReportSchema = z.strictObject({
  image: ImageSchema, release: z.string(), packagesDigest: z.string().regex(/^[a-f0-9]{64}$/),
  profile: ProfileSchema, available: z.boolean(), at: z.iso.datetime(),
  checks: z.array(z.strictObject({ name: z.string(), code: z.number().int(), detail: z.string() })),
});
export type ProbeReport = z.infer<typeof ProbeReportSchema>;
export function profileFor(environment: Pick<Environment, "helpers">): Profile {
  if (environment.helpers.includes("knitr")) return "knitr";
  if (environment.helpers.includes("latexminted") || environment.helpers.includes("quire-tikz")) return "restricted";
  return "default";
}
export function digest(value: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}
export function assertSupported(environment: Environment): void {
  if (environment.backend !== "docker") throw new ServiceError("INVALID_BACKEND", 422, "Only the accepted native manifest may use bwrap");
  ImageSchema.parse(environment.rootOrImageDigest);
  const supported = profileHelpers[profileFor(environment)];
  if (environment.helpers.length !== supported.length || supported.some(helper => !environment.helpers.includes(helper))) {
    throw new ServiceError("UNSUPPORTED_HELPER", 422, "Helpers must exactly match an executed immutable profile");
  }
}
