import { bibliographyKeys } from "./insertion";

export const referenceFields = [
  ["title", "Title"], ["author", "Author"], ["editor", "Editor"], ["journal", "Journal"],
  ["journaltitle", "Journal title (BibLaTeX)"], ["booktitle", "Book title"], ["publisher", "Publisher"],
  ["year", "Year"], ["date", "Date"], ["volume", "Volume"], ["number", "Number"],
  ["pages", "Pages"], ["edition", "Edition"], ["doi", "DOI"], ["url", "URL"],
  ["urldate", "Access date"], ["isbn", "ISBN"], ["note", "Note"],
  ["school", "School"], ["institution", "Institution"], ["organization", "Organization"],
  ["type", "Report / thesis type"], ["series", "Series"], ["address", "Address (BibTeX)"],
  ["location", "Location (BibLaTeX)"], ["eprint", "Eprint"], ["eprinttype", "Eprint type"],
] as const;

/** Read literal fields without expanding TeX or BibTeX string macros. */
export function referenceMetadata(source: string): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};
  const first = bibliographyKeys(source)[0];
  if (!first) return fields;
  let offset = source.indexOf(",", first.offset) + 1;
  while (offset < source.length) {
    while (offset < source.length) {
      if (/[\s,]/.test(source[offset] ?? "")) { offset++; continue; }
      if (source[offset] !== "%") break;
      const end = source.indexOf("\n", offset);
      offset = end < 0 ? source.length : end + 1;
    }
    const match = /^([a-z][\w:-]*)\s*=\s*/i.exec(source.slice(offset));
    if (!match) break;
    offset += match[0].length;
    const start = offset;
    let depth = 0;
    let quoted = false;
    for (; offset < source.length; offset++) {
      const token = source[offset];
      if (token === "\\") { offset++; continue; }
      if (token === '"' && depth === 0) { quoted = !quoted; continue; }
      if (!quoted && depth === 0 && (token === "," || token === "}" || token === ")")) break;
      if (token === "{") depth++;
      if (token === "}") depth--;
    }
    fields[match[1]?.toLowerCase() ?? ""] = source.slice(start, offset).trim()
      .replace(/^\{([\s\S]*)\}$|^"([\s\S]*)"$/g, "$1$2");
  }
  return fields;
}

export type ReferenceFilter = "all" | "key" | "author" | "title" | "journal" | "year" | "date";
export function matchesReference(key: string, fields: Readonly<Record<string, string>>, query: string, filter: ReferenceFilter) {
  const values = filter === "all" ? [key, ...Object.values(fields)] :
    filter === "key" ? [key] : filter === "journal" ? [fields["journal"], fields["journaltitle"]] : [fields[filter]];
  const text = values.filter(Boolean).join(" ").replace(/[{}]/g, "").toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every(term => text.includes(term));
}

export function manualReference(kind: string, key: string, fields: Readonly<Record<string, string>>) {
  const escape = (value: string) => value.replace(/[\\{}%&#_$~^]/g, token => {
    if (token === "\\") return "\\textbackslash{}";
    if (token === "~") return "\\textasciitilde{}";
    if (token === "^") return "\\textasciicircum{}";
    return `\\${token}`;
  }).replace(/[\r\n]+/g, " ");
  return `@${kind}{${key},\n${referenceFields.filter(([name]) => fields[name]?.trim())
    .map(([name]) => `  ${name} = {${escape(fields[name] ?? "")}}`).join(",\n")}\n}`;
}
