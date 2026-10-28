import { assertNever } from "@quire/contracts";
import type { ReviewPanelProps } from "../shared";
import { ChatPanel } from "./chat";
import { HistoryPanel } from "./history";
import { ReviewView } from "./review-view";
import { SharePanel } from "./share";
import "./review.css";

export function ReviewPanel(props: ReviewPanelProps) {
  let content;
  switch (props.view) {
    case "review":
      content = <ReviewView {...props} />;
      break;
    case "history":
      content = <HistoryPanel {...props} />;
      break;
    case "share":
      content = <SharePanel {...props} />;
      break;
    case "chat":
      content = <ChatPanel {...props} />;
      break;
    default:
      assertNever(props.view);
  }
  return <section className="quire-review" aria-label={`${props.view} panel`}>
    <div className="quire-review__body">{content}</div>
  </section>;
}
