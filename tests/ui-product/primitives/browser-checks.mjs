import assert from "node:assert/strict";

// Invoke against primitives-preview.tsx in an omowright-owned browser.
export async function checkInteractions(page) {
  await page.getByRole("button", { name: "Open dialog", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await page.evaluate(() => document.querySelector("dialog").contains(document.activeElement)), true, "dialog receives focus");
  const count = await page.evaluate(() => document.querySelector("dialog").querySelectorAll("button,input").length);
  for (let index = 0; index < count + 2; index++) {
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.querySelector("dialog").contains(document.activeElement)), true, "Tab stays inside dialog");
  }
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.querySelector("dialog").contains(document.activeElement)), true, "reverse Tab stays inside dialog");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 5000 });
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Open dialog", "Escape restores trigger focus");
  const focus = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { visible: document.activeElement.matches(":focus-visible"), width: style.outlineWidth, style: style.outlineStyle };
  });
  assert.equal(focus.visible, true);
  assert.notEqual(focus.width, "0px");
  assert.notEqual(focus.style, "none");
  await page.getByRole("tab", { name: "Profile", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Editor", exact: true }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Profile", exact: true }).getAttribute("aria-selected"), "true", "disabled tab skipped");
  await page.keyboard.press("End");
  assert.equal(await page.getByRole("tab", { name: "Editor", exact: true }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("Home");
  assert.equal(await page.getByRole("tab", { name: "Profile", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await page.getByRole("textbox", { name: "Email", exact: true }).getAttribute("aria-invalid"), "true");
  return { dialogFocus: true, tabTrap: true, reverseTabTrap: true, escape: true, focusReturn: true, focusVisible: focus, tabsArrowsHomeEnd: true, disabledTabSkipped: true, labeledError: true };
}
