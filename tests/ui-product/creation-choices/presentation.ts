import { expect } from "bun:test";
import type { Locator, Page } from "@playwright/test";

type Kind = "template" | "zip" | "github" | "git";

export async function assertChoicesLocked(dialog: Locator, kind: Kind) {
  expect(await dialog.getByLabel("Project name", { exact: true }).isDisabled()).toBe(true);
  for (const name of ["Workspace", "Compiler", "TeX Live version"]) {
    expect(await dialog.getByRole("combobox", { name, exact: true }).isDisabled()).toBe(true);
  }
  expect(await dialog.getByLabel("Main document path (optional)", { exact: true }).isDisabled()).toBe(true);
  if (kind === "github" || kind === "git") {
    expect(await dialog.getByLabel("Repository URL", { exact: true }).isDisabled()).toBe(true);
    expect(await dialog.getByLabel("Branch", { exact: true }).isDisabled()).toBe(true);
    expect(await dialog.getByRole("combobox", { name: "Saved connection", exact: true }).isDisabled()).toBe(true);
    expect(await dialog.getByRole("checkbox", { name: "Import full Git history", exact: true }).isDisabled()).toBe(true);
    expect(await dialog.getByRole("checkbox", { name: "Keep remote connection for pull and push", exact: true }).isDisabled()).toBe(true);
  } else if (kind === "zip") expect(await dialog.getByLabel("Choose file", { exact: true }).isDisabled()).toBe(true);
  else expect(await dialog.getByRole("button", { name: /^Select template / }).first().isDisabled()).toBe(true);
}

export async function captureCreation(page: Page, dialog: Locator, kind: Kind, evidence: string) {
  for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    await dialog.getByLabel("Project name", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/${kind}-top-${width}-${colorScheme}.png` });
    await dialog.getByLabel("Main document path (optional)", { exact: true }).scrollIntoViewIfNeeded();
    await dialog.locator(".q-modal__body").evaluate(node => { node.scrollTop = node.scrollHeight; });
    const probe = await dialog.evaluate(node => {
      const body = node.querySelector(".q-modal__body");
      const header = node.querySelector(".q-modal__header");
      const footer = node.querySelector(".q-modal__footer");
      if (!body || !header || !footer) throw new Error("Creation layout regions required");
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { top: box.top, right: box.right, bottom: box.bottom, left: box.left };
      };
      return {
        owner: ".p-create-dialog > .q-modal__body", viewport: { width: innerWidth, height: innerHeight },
        dialog: rect(node), header: rect(header), body: rect(body), footer: rect(footer),
        overflowY: getComputedStyle(body).overflowY, scrollTop: body.scrollTop,
        scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
        documentWidth: document.documentElement.scrollWidth,
        activeScrollers: [...node.querySelectorAll("*")].filter(element =>
          ["auto", "scroll"].includes(getComputedStyle(element).overflowY)
          && element.scrollHeight > element.clientHeight + 1).map(element => element.className),
      };
    });
    expect(probe.documentWidth).toBeLessThanOrEqual(width);
    expect(probe.overflowY).toBe("auto");
    expect(probe.header.bottom).toBeLessThanOrEqual(probe.body.top + 1);
    expect(probe.body.bottom).toBeLessThanOrEqual(probe.footer.top + 1);
    expect(probe.footer.bottom).toBeLessThanOrEqual(probe.dialog.bottom + 1);
    expect(probe.footer.bottom).toBeLessThanOrEqual(probe.viewport.height);
    expect(probe.scrollTop + probe.clientHeight).toBeGreaterThanOrEqual(probe.scrollHeight - 1);
    expect(probe.activeScrollers.every(name => name === "q-modal__body")).toBe(true);
    await Bun.write(`${evidence}/${kind}-layout-${width}-${colorScheme}.json`, JSON.stringify(probe, null, 2));
    await page.screenshot({ path: `${evidence}/${kind}-settings-${width}-${colorScheme}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
