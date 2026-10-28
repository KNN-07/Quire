import { z } from "zod";
import { PublicationSchema, InstantSchema, DigestSchema } from "@quire/contracts";
import type { Publication } from "@quire/contracts";
import { singleRecord } from "../../core/catalog/bibtex";

export const ProvenanceSchema = z.strictObject({
  provider: z.string().min(1), providerId: z.string().min(1), endpoint: z.url(),
  retrievedAt: InstantSchema, responseDigest: DigestSchema,
}).readonly();
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type RetrievedPublication = {
  readonly publication: Publication; readonly provenance: Provenance;
};
export type PublicationMetadata = Omit<Publication, "bibtex"> & { readonly citationKey?: string };

/** Provider identifiers, not titles or author names, determine fallback keys. */
export function publication(input: PublicationMetadata): Publication {
  const key = input.citationKey ?? `${input.provider.replace(/\W/g, "")}_${new Bun.CryptoHasher("sha256")
    .update(input.providerId).digest("hex").slice(0, 16)}`;
  const escape = (value: string) => value.replace(/[\\{}%&#_$~^]/g, token => {
    switch (token) {
      case "\\": return "\\textbackslash{}";
      case "~": return "\\textasciitilde{}";
      case "^": return "\\textasciicircum{}";
      default: return `\\${token}`;
    }
  }).replace(/[\r\n]+/g, " ");
  const fields = [
    `title = {${escape(input.title)}}`,
    ...(input.authors.length ? [`author = {${input.authors.map(escape).join(" and ")}}`] : []),
    ...(input.year === null ? [] : [`year = {${input.year}}`]),
    ...(input.doi === null ? [] : [`doi = {${escape(input.doi)}}`]),
    ...(input.url === null ? [] : [`url = {${escape(input.url)}}`]),
  ];
  const bibtex = `@misc{${key},\n  ${fields.join(",\n  ")}\n}`;
  singleRecord(bibtex);
  return PublicationSchema.parse({
    provider: input.provider, providerId: input.providerId, title: input.title, authors: input.authors,
    year: input.year, doi: input.doi, url: input.url, bibtex,
  });
}

export const DoiSchema = z.string().trim().transform(value => value
  .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase())
  .pipe(z.string().regex(/^10\.\d{4,9}\/[^\s<>]+$/));
