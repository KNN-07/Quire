import nspell from "nspell";
import ky from "ky";
import { z } from "zod";
import { assertNever } from "@quire/contracts";
import type { Preferences } from "@quire/contracts";
import type { Diagnostic } from "@codemirror/lint";
import { maskedTex } from "./tex";

const asset = z.strictObject({
  version: z.string(),
  aff: z.string().startsWith("/dictionaries/"),
  dic: z.string().startsWith("/dictionaries/"),
  license: z.string().startsWith("/dictionaries/"),
}).readonly();
const manifestSchema = z.strictObject({
  dictionaries: z.strictObject({ "en-US": asset, "en-GB": asset, vi: asset }).readonly(),
  unavailable: z.array(z.literal("zh")).readonly(),
}).readonly();
export type Speller = {
  readonly correct: (word: string) => boolean;
  readonly suggest: (word: string) => readonly string[];
};
export type SpellingState =
  | { readonly kind: "off" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly locale: Exclude<Preferences["dictionary"], "zh">; readonly version: string; readonly license: string; readonly checker: Speller }
  | { readonly kind: "unavailable"; readonly locale: "zh"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };
export type SpellingIssue = Diagnostic & { readonly word: string };

/** A checker owns its mutable dictionary and per-word cache; never shared across users. */
export function createSpeller(data: { readonly aff: string; readonly dic: string }, customWords: readonly string[]): Speller {
  const engine = nspell(data.aff, data.dic);
  for (const word of customWords) engine.add(word.normalize("NFC"));
  const checked = new Map<string, boolean>();
  return {
    correct(word) {
      const normalized = word.normalize("NFC");
      const cached = checked.get(normalized);
      if (cached !== undefined) return cached;
      const result = engine.correct(normalized);
      checked.set(normalized, result);
      return result;
    },
    suggest: word => engine.suggest(word.normalize("NFC")),
  };
}
export async function loadSpelling(
  preferences: Pick<Preferences, "dictionary" | "customWords" | "spellCheck">,
  signal: AbortSignal,
): Promise<SpellingState> {
  if (!preferences.spellCheck) return { kind: "off" };
  const options = { signal, timeout: 30_000, retry: 0, credentials: "same-origin" as const };
  const manifest = manifestSchema.parse(await ky.get("/dictionaries/manifest.json", options).json());
  const locale = preferences.dictionary;
  switch (locale) {
    case "zh": return { kind: "unavailable", locale, message: "A Chinese spelling dictionary is not supplied. Choose English or Vietnamese to check prose; the Chinese interface is independent." };
    case "en-US": case "en-GB": case "vi": {
      const selected = manifest.dictionaries[locale];
      const [aff, dic] = await Promise.all([
        ky.get(selected.aff, options).text(), ky.get(selected.dic, options).text(),
      ]);
      return { kind: "ready", locale, version: selected.version, license: selected.license,
        checker: createSpeller({ aff, dic }, preferences.customWords) };
    }
    default: return assertNever(locale);
  }
}
export function spellingIssues(source: string, checker: Speller): readonly SpellingIssue[] {
  const mask = (text: string) => text.replace(/[^\n]/g, " ");
  const prose = maskedTex(source)
    .replace(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|(?<!\\)\$[^$]*?(?<!\\)\$/g, mask)
    .replace(/\\(?:documentclass|usepackage|begin|end|label|(?:eq|auto|page)?ref|cite\w*|input|include|bibliography|bibliographystyle|includegraphics|url|href)(?:\[[^\]]*\])?\s*\{[^}]*\}/g, mask)
    .replace(/\\[A-Za-z@]+\*?/g, mask);
  return [...prose.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)].flatMap(match => {
    const word = source.slice(match.index, match.index + match[0].length);
    return checker.correct(word) ? [] : [{
      from: match.index, to: match.index + word.length, word, severity: "info" as const,
      source: "Spelling", message: `Not in dictionary: ${word}`,
    }];
  });
}
