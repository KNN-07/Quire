import { beforeAll, describe, expect, test } from "bun:test";
import { createSpeller, spellingIssues } from "../../../apps/web/src/features/editor/source/spelling";
import type { Speller } from "../../../apps/web/src/features/editor/source/spelling";

async function dictionary(locale: string) {
  const base = new URL(`../../../apps/web/public/dictionaries/${locale}/`, import.meta.url);
  const [aff, dic] = await Promise.all([
    Bun.file(new URL("index.aff", base)).text(), Bun.file(new URL("index.dic", base)).text(),
  ]);
  return { aff, dic };
}
describe("bundled Hunspell dictionaries", () => {
  let english: Speller;
  let british: Speller;
  let vietnamese: Speller;
  beforeAll(async () => {
    const [us, gb, vi] = await Promise.all(["en-US", "en-GB", "vi"].map(dictionary));
    if (!us || !gb || !vi) throw new TypeError("Bundled spelling assets missing");
    english = createSpeller(us, ["QuireWord"]);
    british = createSpeller(gb, []);
    vietnamese = createSpeller(vi, []);
  });
  test("uses the selected real English dictionary instead of an OS checker", () => {
    // Given the independently bundled US and British dictionaries.
    const word = "colour";
    // When the same spelling is checked in both locales.
    const result = [english.correct(word), british.correct(word)];
    // Then their actual vocabulary distinguishes the selected locale.
    expect(result).toEqual([false, true]);
  });
  test("recognizes Vietnamese syllables from the supplied dictionary", () => {
    // Given Vietnamese source words and an invented token.
    const words = ["tiếng", "Việt", "zzqxword"];
    // When the real Vietnamese checker evaluates them.
    const result = words.map(word => vietnamese.correct(word));
    // Then known vocabulary passes and the invented token is flagged.
    expect(result).toEqual([true, true, false]);
  });
  test("checks prose while preserving offsets and excluding TeX syntax and math", () => {
    // Given the same unknown token in prose and several non-prose source contexts.
    const source = "\\documentclass{zzqxword}\n\\section{Hello zzqxword}\n\\label{zzqxword}\n\\(zzqxword\\)\n% zzqxword\nQuireWord 😀";
    // When spelling examines the losslessly masked prose.
    const issues = spellingIssues(source, english);
    // Then only the actual prose typo is diagnosed at its original UTF-16 range.
    expect(issues.map(issue => ({ word: issue.word, from: issue.from, to: issue.to }))).toEqual([
      { word: "zzqxword", from: source.indexOf("zzqxword", source.indexOf("\\section")), to: source.indexOf("zzqxword", source.indexOf("\\section")) + "zzqxword".length },
    ]);
  });
  test("honors custom words without leaking them into a separate user's checker", async () => {
    // Given identical actual dictionary data and two independent user dictionaries.
    const data = await dictionary("en-US");
    const personal = createSpeller(data, ["zzqxword"]);
    const other = createSpeller(data, []);
    // When both users check the same custom token.
    const result = [personal.correct("zzqxword"), other.correct("zzqxword")];
    // Then only the user's own explicit addition is accepted.
    expect(result).toEqual([true, false]);
  });
});
