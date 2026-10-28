import type { Diagnostic } from "@codemirror/lint";
import { maskedTex } from "./tex";

export type CheckRule = "braces" | "environment" | "math" | "repeated-word";
export type CheckIssue = Diagnostic & { readonly rule: CheckRule };
export type CheckOptions = { readonly enabled: boolean };

/** Source directives suppress heuristics only, never compiler diagnostics. */
export function codeCheck(source: string, options: CheckOptions): readonly CheckIssue[] {
  if (!options.enabled) return [];
  const disabled = new Set<string>();
  const regions: { from: number; to: number; rules: readonly string[] }[] = [];
  const starts = new Map<string, number>();
  for (const match of source.matchAll(/%[ \t]*quire-check[ \t]+(disable-file|disable|enable)(?:[ \t]+([a-z,-]+))?/g)) {
    const rules = (match[2] ?? "all").split(",");
    for (const rule of rules) {
      if (match[1] === "disable-file") disabled.add(rule);
      else if (match[1] === "disable") starts.set(rule, match.index);
      else {
        const from = starts.get(rule);
        if (from !== undefined) { regions.push({ from, to: match.index, rules: [rule] }); starts.delete(rule); }
      }
    }
  }
  for (const [rule, from] of starts) regions.push({ from, to: source.length, rules: [rule] });
  const issues: CheckIssue[] = [];
  const add = (issue: CheckIssue) => {
    if (disabled.has("all") || disabled.has(issue.rule)) return;
    if (regions.some(region => issue.from >= region.from && issue.from <= region.to
      && (region.rules.includes("all") || region.rules.includes(issue.rule)))) return;
    issues.push(issue);
  };
  const text = maskedTex(source);
  const braces: number[] = [];
  const environments: { readonly name: string; readonly from: number; readonly to: number }[] = [];
  for (let offset = 0; offset < text.length; offset++) {
    if (text[offset] === "\\") { offset++; continue; }
    if (text[offset] === "{") braces.push(offset);
    if (text[offset] === "}") {
      if (braces.length) braces.pop();
      else add({ from: offset, to: offset + 1, severity: "warning", source: "Code Check", rule: "braces", message: "Closing brace has no opening brace." });
    }
  }
  for (const from of braces) add({ from, to: from + 1, severity: "warning", source: "Code Check", rule: "braces", message: "Opening brace has no closing brace." });
  for (const match of text.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
    const name = match[2] ?? "";
    if (match[1] === "begin") environments.push({ name, from: match.index, to: match.index + match[0].length });
    else if (environments.at(-1)?.name === name) environments.pop();
    else add({ from: match.index, to: match.index + match[0].length, severity: "warning", source: "Code Check", rule: "environment", message: `Unexpected end of ${name}.` });
  }
  for (const environment of environments) add({ ...environment, severity: "warning", source: "Code Check", rule: "environment", message: `Environment ${environment.name} is not closed.` });
  const math: { readonly delimiter: string; readonly from: number }[] = [];
  for (const match of text.matchAll(/\\[()[\]]|(?<!\\)\${1,2}/g)) {
    const delimiter = match[0];
    const current = math.at(-1);
    const expected = current?.delimiter === "\\(" ? "\\)" : current?.delimiter === "\\[" ? "\\]" : current?.delimiter;
    if (current && delimiter === expected) math.pop();
    else if (!current) math.push({ delimiter, from: match.index });
  }
  for (const current of math) add({ from: current.from, to: current.from + current.delimiter.length, severity: "warning", source: "Code Check", rule: "math", message: "Math delimiter is not paired." });
  for (const match of text.matchAll(/\b([\p{L}]+)[ \t]+\1\b/giu)) add({
    from: match.index, to: match.index + match[0].length, severity: "info", source: "Code Check",
    rule: "repeated-word", message: `Repeated word: ${match[1] ?? ""}.`,
  });
  return issues.sort((a, b) => a.from - b.from);
}
