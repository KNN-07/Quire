import { z } from "zod";
import { ZoteroSelectionSchema } from "./zotero";
import { MendeleySelectionSchema } from "./mendeley";

export const BibliographySelectionSchema = z.union([ZoteroSelectionSchema, MendeleySelectionSchema]);
export type BibliographySelection = z.infer<typeof BibliographySelectionSchema>;
