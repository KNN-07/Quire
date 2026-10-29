import { expect, test } from "bun:test";
import { actorColor, replacementSpan } from "../../../../apps/web/src/features/editor/review/change-preview";

test("replacement spans preserve both exact texts including Unicode and disjoint changes", () => {
  for (const [before, after] of [
    ["same\n", "same\n"], ["", "new"], ["old", ""], ["a😀b", "a😁b"],
    ["alpha\nunchanged\nomega\n", "ALPHA\nunchanged\nOMEGA\n"],
  ]) {
    if (before === undefined || after === undefined) throw new TypeError("Missing input");
    const span = replacementSpan(before, after);
    expect(span.prefix + span.removed + span.suffix).toBe(before);
    expect(span.prefix + span.inserted + span.suffix).toBe(after);
    expect(Object.values(span).every(value => value.isWellFormed())).toBe(true);
  }
  expect(actorColor("recorded-actor")).toBe(actorColor("recorded-actor"));
});
