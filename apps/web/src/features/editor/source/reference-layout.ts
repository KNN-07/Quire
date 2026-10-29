import { selectedCompletion } from "@codemirror/autocomplete";
import { ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

/** Reveal selected keys below the sticky heading; compact sheets also retain the caret. */
export const referenceLayout = ViewPlugin.define(view => {
  const compact = window.matchMedia("(max-width: 767px)");
  let active = true;
  const read = () => {
    const sheet = view.dom.querySelector(".q-reference-tooltip");
    const list = sheet?.querySelector("ul");
    const heading = sheet?.querySelector(".q-reference-heading");
    if (!sheet?.getClientRects().length || !list || !heading) return null;
    const selected = list.querySelector("[aria-selected=true]");
    const selectedBox = selected?.getBoundingClientRect();
    const headingBox = heading.getBoundingClientRect();
    const position = view.state.selection.main.head;
    const caret = view.coordsAtPos(position);
    const bounds = view.scrollDOM.getBoundingClientRect();
    return {
      list, position,
      top: selectedBox && selectedBox.top < headingBox.bottom - 1
        ? Math.max(0, list.scrollTop + selectedBox.top - headingBox.bottom) : null,
      reveal: compact.matches && bounds.height >= view.defaultLineHeight + 10
        && (!caret || caret.top < bounds.top - 1 || caret.bottom > bounds.bottom + 1),
    };
  };
  const measure = {
    read,
    write(layout: ReturnType<typeof read>) {
      if (!layout) return;
      if (layout.top !== null) layout.list.scrollTop = layout.top;
      if (layout.reveal) queueMicrotask(() => {
        if (active && layout.list.isConnected && view.state.selection.main.head === layout.position) {
          view.dispatch({ scrollIntoView: true });
        }
      });
    },
  };
  const request = () => view.requestMeasure(measure);
  const observer = new ResizeObserver(request);
  observer.observe(view.scrollDOM);
  compact.addEventListener("change", request);
  return {
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.geometryChanged
        || selectedCompletion(update.startState) !== selectedCompletion(update.state)) request();
    },
    destroy() {
      active = false;
      observer.disconnect();
      compact.removeEventListener("change", request);
    },
  };
});
