import type { Page } from "@playwright/test";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { waitForRenderedText } from "../shared";

export async function openPanel(page: Page, input: {
  readonly view: "review" | "history" | "share" | "chat";
  readonly theme?: "light" | "dark";
  readonly select?: string;
  readonly live?: boolean;
}) {
  const query = new URLSearchParams({
    project: ids.project, file: ids.mainFile, view: input.view,
    theme: input.theme ?? "light", ...(input.select ? { select: input.select } : {}),
  });
  await page.goto(`/src/features/editor/review/fixture.html?${query}`, {
    waitUntil: "domcontentloaded", timeout: 30_000,
  });
  await waitForRenderedText(page, "Review fixture ready");
  if (input.live !== false) {
    await waitForAttribute(page, {
      selector: "[data-review-live]", name: "data-review-live", value: "true",
    });
  }
}

export async function waitForAttribute(
  page: Page,
  expected: { readonly selector: string; readonly name: string; readonly value: string },
): Promise<void> {
  await page.evaluate(({ selector: target, name: attribute, value: targetValue }) =>
    new Promise<void>((resolve, reject) => {
      const signal = AbortSignal.timeout(30_000);
      const observer = new MutationObserver(check);
      const abort = () => { observer.disconnect(); reject(signal.reason); };
      function check() {
        const node = document.querySelector(target);
        if (node?.getAttribute(attribute) !== targetValue) return;
        observer.disconnect(); signal.removeEventListener("abort", abort); resolve();
      }
      signal.addEventListener("abort", abort, { once: true });
      observer.observe(document.documentElement, {
        subtree: true, childList: true, attributes: true, attributeFilter: [attribute],
      });
      check();
    }), expected);
}
