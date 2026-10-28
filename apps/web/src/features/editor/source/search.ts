import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import type { SelectionRange } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";

export const setSearchScope = StateEffect.define<SelectionRange | null>();
export const searchScope = StateField.define<SelectionRange | null>({
  create: () => null,
  update(value, transaction) {
    let next = value?.map(transaction.changes) ?? null;
    for (const effect of transaction.effects) if (effect.is(setSearchScope)) next = effect.value;
    return next;
  },
});
export type SourceQuery = {
  readonly search: string;
  readonly replace: string;
  readonly caseSensitive: boolean;
  readonly regexp: boolean;
  readonly wholeWord: boolean;
};
export function sourceQuery(options: SourceQuery): SearchQuery {
  return new SearchQuery({
    ...options, literal: true,
    test: (_match, state, from, to) => {
      const scope = state.field(searchScope, false);
      return !scope || (from >= scope.from && to <= scope.to);
    },
  });
}
export function selectionScope(anchor: number, head: number): SelectionRange {
  return EditorSelection.range(anchor, head);
}
