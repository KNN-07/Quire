import { expect, test } from "bun:test";
import { remoteCitationQuery } from "../../../apps/web/src/features/editor/source/remote-completion";
import { referenceReceipt } from "../../../apps/web/src/features/editor/source/reference-receipt";

test.each([
  "% \\cite{private",
  "\\begin{verbatim}\n\\cite{private",
  "\\begin{lstlisting}\n\\cite{private",
  "\\begin{minted}{tex}\n\\cite{private",
  "\\verb|\\cite{private",
  "\\\\cite{private",
  "\\cite{public % private",
])("does not extract an external reference query from inert source: %s", source => {
  // Given a comment, literal region or escaped command.
  const position = source.length;
  // When determining the query that would be sent to a provider.
  const query = remoteCitationQuery(source, position);
  // Then no private literal/comment content is eligible for external lookup.
  expect(query).toBeNull();
});

test.each(["\\cite{Hopper", "\\citep[see][p. 2]{known, Hopper", "\\% \\cite{Hopper"])(
  "extracts only the active citation argument: %s", source => {
    // Given a live citation argument, possibly after an existing key.
    const start = source.indexOf("Hopper");
    // When extracting the active argument.
    const query = remoteCitationQuery(source, source.length);
    // Then the provider receives only that query and the exact replacement span.
    if (!query) throw new TypeError("A live citation argument must produce a query.");
    expect(query.query.trim()).toBe("Hopper");
    expect(source.slice(query.from)).toBe(query.query);
    expect(query.from).toBeLessThanOrEqual(start);
  },
);

test("receipt storage isolates sessions and scopes and retains only the most recent receipt", () => {
  // Given one tab's storage and an actual receipt written under session A.
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  referenceReceipt(storage, "session-A", "project:main", "first-copy");
  // When another session or scope reads that storage.
  const otherSession = referenceReceipt(storage, "session-B", "project:main");
  const otherScope = referenceReceipt(storage, "session-A", "other:main");
  // Then receipts are private to their initiating session and scope.
  expect(otherSession).toBe("");
  expect(otherScope).toBe("");
  expect(referenceReceipt(storage, "session-A", "project:main")).toBe("first-copy");
  referenceReceipt(storage, "session-B", "other:main", "second-copy");
  expect(values.size).toBe(1);
  expect(referenceReceipt(storage, "session-A", "project:main")).toBe("");
});
