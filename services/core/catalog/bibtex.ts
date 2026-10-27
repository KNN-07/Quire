import { ServiceError } from "@quire/runtime";

export type BibRecord = { readonly citationKey: string; readonly bibtex: string };
function invalid(): never { throw new ServiceError("INVALID_BIBTEX", 422, "Expected complete BibTeX records with unique citation keys"); }

function checkFields(source: string): void {
  let flat = "";
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const token = source[index];
    if (token === "\\") { index++; continue; }
    if (token === '"' && depth === 0) {
      quoted = !quoted;
      if (quoted) flat += "value";
      continue;
    }
    if (quoted) continue;
    if (token === "{") { if (depth === 0) flat += "value"; depth++; continue; }
    if (token === "}") { depth--; continue; }
    if (depth === 0) flat += token;
  }
  const atom = "[a-z0-9_:.+/-]+";
  const value = `${atom}(?:\\s*#\\s*${atom})*`;
  const field = `[a-z][\\w:-]*\\s*=\\s*${value}`;
  if (!new RegExp(`^\\s*(?:${field}\\s*(?:,\\s*${field}\\s*)*,?)?\\s*$`, "i").test(flat)) invalid();
}

/** Balanced BibTeX scanner; source text and macro declarations remain byte-for-byte editable. */
export function parseBibtex(source: string): readonly BibRecord[] {
  if (source.includes("\0") || !source.isWellFormed()) invalid();
  const records: BibRecord[] = [];
  const declarations: string[] = [];
  const keys = new Set<string>();
  let offset = 0;
  while (offset < source.length) {
    const char = source[offset];
    if (char === "%") {
      const end = source.indexOf("\n", offset);
      offset = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char !== "@") { offset++; continue; }
    const start = offset;
    const header = /^@([a-z]+)\s*([{(])/i.exec(source.slice(offset));
    if (!header) invalid();
    const kind = header[1]?.toLowerCase();
    const open = header[2];
    const close = open === "{" ? "}" : ")";
    offset += header[0].length;
    const bodyStart = offset;
    let depth = 0;
    let quoted = false;
    let complete = false;
    for (; offset < source.length; offset++) {
      const token = source[offset];
      if (token === "\\") { offset++; continue; }
      if (token === '"' && depth === 0) { quoted = !quoted; continue; }
      if (!quoted && token === close && depth === 0) { complete = true; break; }
      if (token === "{") depth++;
      if (token === "}") { depth--; if (depth < 0) invalid(); }
    }
    if (!complete || quoted || depth !== 0) invalid();
    const body = source.slice(bodyStart, offset);
    const text = source.slice(start, ++offset);
    if (kind === "comment" || kind === "string" || kind === "preamble") {
      declarations.push(text); continue;
    }
    const keyMatch = /^\s*([^,\s{}()\\]+)\s*,/.exec(body);
    const key = keyMatch?.[1];
    if (!key || keys.has(key) || !/^[\w:./+-]+$/u.test(key)) invalid();
    checkFields(body.slice(keyMatch?.[0].length));
    keys.add(key);
    records.push({ citationKey: key, bibtex: text });
  }
  if (!records.length) invalid();
  const prefix = declarations.length ? `${declarations.join("\n")}\n` : "";
  return records.map(record => ({ ...record, bibtex: prefix + record.bibtex }));
}

export function singleRecord(source: string): BibRecord {
  const records = parseBibtex(source);
  const record = records[0];
  if (records.length !== 1 || !record) invalid();
  return record;
}
