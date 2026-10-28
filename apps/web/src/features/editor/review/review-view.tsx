import type { ReviewPanelProps } from "../shared";
import { SuggestionsPanel } from "./suggestions";
import { ThreadsPanel } from "./threads";

export function ReviewView(props: ReviewPanelProps) {
  return <div className="quire-review__review-grid">
    <main><SuggestionsPanel {...props} /></main>
    <aside><ThreadsPanel {...props} /></aside>
  </div>;
}
