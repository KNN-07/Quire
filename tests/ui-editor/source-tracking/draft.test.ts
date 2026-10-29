import { expect, test } from "bun:test";
import { draftChange } from "../../../apps/web/src/features/editor/source/tracking";

test("net source proposals preserve code points, CRLF and exact replacement bytes", () => {
  const cases = [
    ["", "中文 😀"], ["abc", ""], ["a😀z", "a😁z"], ["a😀z", "aX😀z"],
    ["a😀z", "a😀Xz"], ["\r\nA\r\n", "\r\nB\r\n"], ["Tiếng Việt", "Tiếng 中文"],
    ["begin alpha middle beta end", "begin ALPHA middle BETA end"], ["same", "same"],
  ];
  for (const [before, after] of cases) {
    if (before === undefined || after === undefined) throw new Error("Invalid test input");
    const edit = draftChange(before, after);
    expect(before.slice(0, edit.from) + edit.after + before.slice(edit.to)).toBe(after);
    expect(edit.before).toBe(before.slice(edit.from, edit.to));
    expect(edit.before.isWellFormed()).toBe(true);
    expect(edit.after.isWellFormed()).toBe(true);
  }
});
