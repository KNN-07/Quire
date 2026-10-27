import { test, expect } from "bun:test";
import { parseBibtex, singleRecord } from "../../../services/core/catalog";
import { bib, secondBib } from "./harness";

test("preserves nested and macro bibliography data when parsing uploaded records", () => {
  // Given: nested title braces, escaped quotes, a macro and parenthesized records.
  const source = `@string{journal = "Actual Journal"}\n${bib}\n@article(third,title="A \\"quoted\\" title",journal=journal)\n${secondBib}`;
  // When: the editable source is parsed.
  const records = parseBibtex(source);
  // Then: each independently copied record retains required macros and its key.
  expect(records.map(record => record.citationKey)).toEqual(["first", "third", "second"]);
  expect(records.every(record => record.bibtex.startsWith('@string{journal = "Actual Journal"}'))).toBe(true);
});

for (const source of ["", "@article{broken,title={Unclosed}", `${bib}\n${bib}`, "@article{bad key,title={No}}", "@article{key,title=}", "@book{key,not a field}"]) {
  test(`rejects malformed or ambiguous bibliography when parsing ${JSON.stringify(source)}`, () => {
    // Given: malformed input or duplicate citation keys.
    // When / Then: parsing refuses ambiguous editable source.
    expect(() => parseBibtex(source)).toThrow();
  });
}

test("rejects several records when creating one Library entry", () => {
  // Given: a code-form payload containing several records.
  // When / Then: the single-entry boundary rejects it.
  expect(() => singleRecord(`${bib}\n${secondBib}`)).toThrow();
});
