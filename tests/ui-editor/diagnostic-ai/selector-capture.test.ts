import { expect, test } from "bun:test";
import { surfaceSignal } from "../assembly/actual-browser";
import { brokenDiagnostic, diagnosticFixture } from "./fixture";

test("captures the card-bound diagnostic selector at both viewport widths", async () => {
  await using setup = await diagnosticFixture();
  const original = await brokenDiagnostic(setup);
  const selected = await surfaceSignal(setup.page, '.qa-assistant [aria-label="Selected diagnostic"]');
  await original.card.getByRole("button", { name: "Fix with AI", exact: true }).click();
  await selected.observed;
  const selector = setup.page.getByLabel("Compile diagnostic", { exact: true });
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await setup.page.setViewportSize({ width, height: 900 });
    await setup.page.evaluate(value => { document.documentElement.dataset["theme"] = value; }, theme);
    await selector.evaluate(element => element.scrollIntoView({ block: "center" }));
    expect(await selector.isDisabled()).toBe(true);
    expect(await selector.inputValue()).toBe(original.diagnostic.id);
    const bounds = await selector.boundingBox();
    if (!bounds) throw new TypeError("Diagnostic selector must be visible");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await setup.page.screenshot({ path: `${setup.evidence}/selector-${width}-${theme}.png` });
  }
  expect(setup.provider.received).toHaveLength(0);
}, 180_000);
