import { expect, test } from "bun:test";
import { manualReference, matchesReference, referenceMetadata } from "../../../apps/web/src/features/editor/tools/library-metadata";
import { singleRecord } from "../../../services/core/catalog/bibtex";

test("rich manual types generate valid escaped BibTeX and BibLaTeX records", () => {
  for (const kind of ["article", "book", "inproceedings", "incollection", "proceedings", "phdthesis", "mastersthesis", "techreport", "online", "report", "thesis", "misc"]) {
    const source = manualReference(kind, "native:2026", {
      title: "A & B {literal}", author: "Ada Lovelace and Grace Hopper", date: "2026-10-27",
      journal: "Journal of Tests", publisher: "Press", doi: "10.1234/native", url: "https://example.org/a_b",
      school: "Native University", institution: "Research Institute", location: "London",
    });
    expect(singleRecord(source).citationKey).toBe("native:2026");
    expect(source).toContain(`@${kind}{native:2026,`);
    expect(source).toContain("A \\& B \\{literal\\}");
    expect(referenceMetadata(source)["date"]).toBe("2026-10-27");
    expect(referenceMetadata(source)["school"]).toBe("Native University");
    expect(referenceMetadata(source)["institution"]).toBe("Research Institute");
  }
});

test("literal field filtering handles nested braces, quotes, numeric years and BibLaTeX journals", () => {
  const fields = referenceMetadata(`% @article{ignored,title={No}}
@string{journal = "macro"}
@article{first, title={Nested {DNA} and @misc{not_a_key}}, author="Ada and Grace",
  journaltitle={Native Journal}, % journal comment
  year=2026, date={2026-10-27}, note={title={Not a title}}}
@article{second, title={Wrong record}, year={1999}}`);
  expect(fields["title"]).toBe("Nested {DNA} and @misc{not_a_key}");
  for (const [filter, query] of [["title", "DNA"], ["author", "grace"], ["journal", "native"], ["year", "2026"], ["date", "10-27"], ["key", "first"]] as const) {
    expect(matchesReference("first", fields, query, filter)).toBe(true);
  }
  expect(matchesReference("first", fields, "Wrong", "title")).toBe(false);
  expect(matchesReference("first", fields, "Not a title", "title")).toBe(false);
  expect(matchesReference("first", fields, "1999", "year")).toBe(false);
  expect(matchesReference("first", fields, "native grace", "all")).toBe(true);
});
