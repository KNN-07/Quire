import type { Page } from "@playwright/test";

/** Arm a bounded DOM signal before its action; no timed polling or retrying assertions. */
export async function surfaceSignal(page: Page, selector: string, timeoutMs = 30_000) {
  const token = `ASSEMBLY_DOM_${crypto.randomUUID()}`;
  const observed = page.waitForEvent("console", {
    predicate: message => message.text().startsWith(token), timeout: timeoutMs + 5_000,
  }).then(message => {
    if (message.text() !== token) throw new TypeError(`Surface not observed: ${selector}`);
  });
  await page.evaluate(({ selector: target, token: marker, timeout }) => {
    const observer = new MutationObserver(check);
    const deadline = setTimeout(() => {
      observer.disconnect(); console.info(marker + ":timeout");
    }, timeout);
    function check() {
      const node = document.querySelector(target);
      if (!node || !node.getClientRects().length) return;
      observer.disconnect(); clearTimeout(deadline); console.info(marker);
    }
    observer.observe(document, { childList: true, subtree: true, attributes: true });
    check();
  }, { selector, token, timeout: timeoutMs });
  return { observed };
}
export async function openSurface(page: Page, input: { readonly path: string; readonly selector: string }) {
  const token = `ASSEMBLY_NAV_${crypto.randomUUID()}`;
  await page.addInitScript(({ selector, marker }) => {
    const observer = new MutationObserver(check);
    const deadline = setTimeout(() => {
      observer.disconnect(); console.info(marker + ":timeout");
    }, 30_000);
    function check() {
      const node = document.querySelector(selector);
      if (!node || !node.getClientRects().length) return;
      observer.disconnect(); clearTimeout(deadline); console.info(marker);
    }
    observer.observe(document, { childList: true, subtree: true, attributes: true });
  }, { selector: input.selector, marker: token });
  const ready = page.waitForEvent("console", {
    predicate: message => message.text().startsWith(token), timeout: 35_000,
  });
  const [message] = await Promise.all([ready, page.goto(input.path, { waitUntil: "domcontentloaded", timeout: 30_000 })]);
  if (message.text() !== token) throw new TypeError(`Route surface not observed: ${input.path}`);
}
