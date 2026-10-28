import { StorageError } from "@quire/runtime";

/** Only parameter markers change. Use ?? for a literal PostgreSQL ? operator. */
export function postgresPlaceholders(sql: string, parameterCount: number): string {
  let result = "";
  let count = 0;
  let i = 0;
  while (i < sql.length) {
    const start = i;
    const char = sql[i];
    if (char === "'" || char === '"') {
      const escape = char === "'" && /[eE]/.test(sql[i - 1] ?? "") &&
        !/[a-zA-Z0-9_$\u0080-\uffff]/.test(sql[i - 2] ?? "");
      i++;
      let closed = false;
      while (i < sql.length) {
        if (escape && sql[i] === "\\") { i += 2; continue; }
        if (sql[i++] === char) {
          if (sql[i] === char) { i++; continue; }
          closed = true;
          break;
        }
      }
      if (!closed) throw new StorageError("INVALID_SQL", "Unterminated quoted SQL");
    } else if (sql.startsWith("--", i)) {
      const end = /[\r\n]/.exec(sql.slice(i + 2));
      i = end ? i + 2 + end.index + 1 : sql.length;
    } else if (sql.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.startsWith("/*", i)) { depth++; i += 2; }
        else if (sql.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new StorageError("INVALID_SQL", "Unterminated SQL comment");
    } else if (char === "$" && !/[a-zA-Z0-9_$\u0080-\uffff]/.test(sql[i - 1] ?? "")) {
      const tag = /^\$(?:[a-zA-Z_\u0080-\uffff][a-zA-Z0-9_\u0080-\uffff]*)?\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        if (end < 0) throw new StorageError("INVALID_SQL", "Unterminated dollar quote");
        i = end + tag.length;
      } else {
        if (/^\$\d/.test(sql.slice(i))) throw new StorageError("INVALID_SQL", "Use ? parameters, not $n");
        i++;
      }
    } else if (char === "?") {
      if (sql[i + 1] === "?") { result += "?"; i += 2; }
      else { result += `$${++count}`; i++; }
      continue;
    } else i++;
    result += sql.slice(start, i);
  }
  if (count !== parameterCount) throw new StorageError("SQL_PARAMETER_COUNT", `${count} markers, ${parameterCount} values`);
  return result;
}
