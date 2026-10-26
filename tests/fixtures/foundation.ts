import { IdSchema, PolicySchema, PreferencesSchema } from "@quire/contracts";

export const fixtureIds = {
  kien: IdSchema.parse("00000000-0000-4000-8000-000000000001"),
  mai: IdSchema.parse("00000000-0000-4000-8000-000000000002"),
  sam: IdSchema.parse("00000000-0000-4000-8000-000000000003"),
  alex: IdSchema.parse("00000000-0000-4000-8000-000000000004"),
  outsider: IdSchema.parse("00000000-0000-4000-8000-000000000005"),
  operator: IdSchema.parse("00000000-0000-4000-8000-000000000006"),
  team: IdSchema.parse("00000000-0000-4000-8000-000000000010"),
  institution: IdSchema.parse("00000000-0000-4000-8000-000000000011"),
  project: IdSchema.parse("00000000-0000-4000-8000-000000000020"),
  branch: IdSchema.parse("00000000-0000-4000-8000-000000000021"),
  environment: IdSchema.parse("00000000-0000-4000-8000-000000000030"),
  snapshot: IdSchema.parse("00000000-0000-4000-8000-000000000040"),
  mainFile: IdSchema.parse("00000000-0000-4000-8000-000000000101"),
} as const;
export const seedUsers = [
  { id: fixtureIds.kien, name: "Kien Nguyen", email: "kien@quire.local", role: "owner", operator: false },
  { id: fixtureIds.mai, name: "Mai Tran", email: "mai@quire.local", role: "editor", operator: false },
  { id: fixtureIds.sam, name: "Sam", email: "sam@quire.local", role: "reviewer", operator: false },
  { id: fixtureIds.alex, name: "Alex", email: "alex@quire.local", role: "viewer", operator: false },
  { id: fixtureIds.outsider, name: "Outsider", email: "outsider@quire.local", role: null, operator: false },
  { id: fixtureIds.operator, name: "Operator", email: "operator@quire.local", role: null, operator: true },
] as const;
export const defaultPolicy = PolicySchema.parse({
  compileSeconds: 180, writableMembers: null, historyDays: null, trackChanges: true,
  chat: true, ai: "off", aiDailyUses: 50, sharing: "named", anonymousRead: false, anonymousEdit: false,
});
export const defaultPreferences = PreferencesSchema.parse({
  theme: "system", bindings: "default", fontSize: 13, fontFamily: "plex", lineHeight: "normal",
  defaultView: "split", defaultEngine: "pdflatex", dictionary: "en-US", spellCheck: true,
  customWords: [], viewer: "builtin", autoCompile: false, autocomplete: true, autoClose: true,
  cursors: true, aiModel: null, aiMode: "ask", aiStyle: "match", citationProviders: [],
  inlineCompletion: false, errorAssist: false, citationWebSearch: false, aiBranch: false,
  shareAiChat: false, compileBeforeCommit: false, version: 0,
});
export const exampleFiles = [
  { id: fixtureIds.mainFile, path: "main.tex", kind: "file", mime: "text/x-tex", editable: true },
  { id: IdSchema.parse("00000000-0000-4000-8000-000000000102"), path: "sections", kind: "folder", mime: "inode/directory", editable: false },
  { id: IdSchema.parse("00000000-0000-4000-8000-000000000103"), path: "sections/intro.tex", kind: "file", mime: "text/x-tex", editable: true },
  { id: IdSchema.parse("00000000-0000-4000-8000-000000000104"), path: "sections/method.tex", kind: "file", mime: "text/x-tex", editable: true },
  { id: IdSchema.parse("00000000-0000-4000-8000-000000000105"), path: "sections/results.tex", kind: "file", mime: "text/x-tex", editable: true },
  { id: IdSchema.parse("00000000-0000-4000-8000-000000000106"), path: "refs.bib", kind: "file", mime: "text/x-bibtex", editable: true },
  { id: IdSchema.parse("00000000-0000-4000-8000-000000000107"), path: "quire.yml", kind: "file", mime: "text/yaml", editable: true },
] as const;
