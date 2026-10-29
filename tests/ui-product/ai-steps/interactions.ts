import { expect } from "bun:test";
import type { StepsFixture } from "./fixture";

export async function interactionEvidence(setup: StepsFixture) {
  const { page } = setup;
  const receipts: unknown[] = [];
  for (const width of [1440, 390]) for (const theme of ["light", "dark"] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
    if (!await page.getByRole("region", { name: "Assistant", exact: true }).isVisible()) {
      await page.getByRole("button", { name: "Assistant", exact: true }).last().click();
    }
    const summary = page.locator(".qa-assistant__step-times summary");
    await summary.focus();
    await summary.press("Enter");
    expect(await page.locator(".qa-assistant__step-times").evaluate(node => node.hasAttribute("open"))).toBe(true);
    await summary.press("Enter");
    expect(await page.locator(".qa-assistant__step-times").evaluate(node => node.hasAttribute("open"))).toBe(false);
    const focused = await summary.evaluate(node => ({ active: node === document.activeElement,
      style: getComputedStyle(node).outlineStyle, width: getComputedStyle(node).outlineWidth }));
    expect(focused.active).toBe(true);
    expect(focused.style).not.toBe("none");
    expect(Number.parseFloat(focused.width)).toBeGreaterThan(0);
    await page.screenshot({ path: `${setup.evidence}/times-focus-${width}-${theme}.png` });
    const next = await summary.evaluateHandle(node => {
      const region = node.closest(".qa-assistant");
      if (!region) throw new Error("Assistant region required");
      const targets = [...region.querySelectorAll<HTMLElement>("button,a[href],input,select,textarea,summary,[tabindex]")]
        .filter(item => item.tabIndex >= 0 && !item.matches(":disabled") && item.getClientRects().length > 0);
      const position = targets.findIndex(item => item === node);
      const target = targets[position + 1];
      if (!target) throw new Error("Following native tab target required");
      return target;
    });
    try {
      await summary.press("Tab");
      expect(await next.evaluate(node => node === document.activeElement)).toBe(true);
    } finally { await next.dispose(); }
    await page.mouse.move(0, 0);
    const beforeHover = await summary.evaluate(node => getComputedStyle(node).backgroundColor);
    await summary.hover();
    const hovered = await summary.evaluate(node => ({ hover: node.matches(":hover"), background: getComputedStyle(node).backgroundColor }));
    expect(hovered.hover).toBe(true);
    expect(hovered.background).not.toBe(beforeHover);
    await page.screenshot({ path: `${setup.evidence}/times-hover-${width}-${theme}.png` });
    receipts.push({ width, theme, focused, beforeHover, hovered, naturalTabOrder: true });
    if (width === 390) {
      const overlay = page.getByRole("dialog", { name: "Assistant", exact: true });
      await page.keyboard.press("Escape");
      await overlay.waitFor({ state: "hidden" });
      const tools = page.getByRole("dialog", { name: "Project tools", exact: true });
      const toolsWereOpen = await tools.isVisible();
      if (toolsWereOpen) {
        await page.keyboard.press("Escape");
        await tools.waitFor({ state: "hidden" });
      }
      const trigger = page.locator(".qe-project-header").getByRole("button", { name: "Assistant", exact: true });
      await trigger.evaluate(node => {
        node.addEventListener("click", () => node.setAttribute("data-p68-click", "observed"), { once: true });
      });
      await trigger.focus(); await trigger.press("Enter");
      try { await overlay.waitFor({ state: "visible" }); }
      catch (error) {
        const diagnostic = await page.evaluate(() => ({
          url: location.href, width: innerWidth,
          buttons: [...document.querySelectorAll(".qe-project-header button")].map(node => node.outerHTML),
          dialogs: [...document.querySelectorAll("dialog")].map(node => node.outerHTML),
          active: document.activeElement?.outerHTML,
        }));
        const captures = await Promise.allSettled([
          Bun.write(`${setup.evidence}/overlay-failed-${theme}.json`, JSON.stringify(diagnostic, null, 2)),
          page.screenshot({ path: `${setup.evidence}/overlay-failed-${theme}.png` }),
        ]);
        console.info("P68_OVERLAY_CAPTURE", captures.map(result => result.status));
        throw error;
      }
      await page.keyboard.press("Tab");
      expect(await overlay.evaluate(node => node.contains(document.activeElement))).toBe(true);
      await page.screenshot({ path: `${setup.evidence}/overlay-keyboard-open-${theme}.png` });
      await page.keyboard.press("Escape");
      await overlay.waitFor({ state: "hidden" });
      expect(await trigger.evaluate(node => node === document.activeElement)).toBe(true);
      await page.screenshot({ path: `${setup.evidence}/overlay-keyboard-closed-${theme}.png` });
      receipts.push({ width, theme, toolsWereOpen, overlayKeyboardOpen: true, focusContained: true, escapeClosed: true, focusRestored: true });
    }
  }
  await Bun.write(`${setup.evidence}/interactions.json`, JSON.stringify(receipts, null, 2));
}
