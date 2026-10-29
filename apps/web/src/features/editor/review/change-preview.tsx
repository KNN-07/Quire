/** One exact replacement span; interior equal text is not claimed as separately authored. */
export function replacementSpan(before: string, after: string) {
  const left = Array.from(before);
  const right = Array.from(after);
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let end = 0;
  while (end < left.length - start && end < right.length - start
    && left[left.length - end - 1] === right[right.length - end - 1]) end++;
  return {
    prefix: left.slice(0, start).join(""),
    removed: left.slice(start, left.length - end).join(""),
    inserted: right.slice(start, right.length - end).join(""),
    suffix: end ? left.slice(left.length - end).join("") : "",
  };
}

export function actorColor(id: string): number {
  return Array.from(id).reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0) % 4;
}

export function ChangePreview({ before, after }: { readonly before: string; readonly after: string }) {
  const span = replacementSpan(before, after);
  const leading = span.prefix.split("\n");
  const trailing = span.suffix.split("\n");
  return <pre className="quire-change__source" aria-label="Replacement span with adjacent source context"><code>
    {leading.length > 3 && <span aria-label="Earlier context omitted">{"...\n"}</span>}{leading.slice(-3).join("\n")}
    {span.removed && <del>{span.removed}</del>}{span.inserted && <ins>{span.inserted}</ins>}
    {trailing.slice(0, 3).join("\n")}{trailing.length > 3 && <span aria-label="Later context omitted">{"\n..."}</span>}</code></pre>;
}
