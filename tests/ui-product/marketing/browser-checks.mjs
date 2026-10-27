import assert from "node:assert/strict";

export async function checkMarketing(page, origin) {
  // Given: a real rendered landing route.
  await page.goto(origin);
  // When: the landing surface is inspected and its navigation followed.
  assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Write LaTeX together.Version it like code.");
  const deadLinks = await page.evaluate(() => [...document.querySelectorAll("a")].filter(a => a.getAttribute("href") === "#").length);
  // Then: entry actions have concrete route targets.
  assert.equal(deadLinks, 0);
  assert.equal(await page.getByRole("link", { name: "Browse templates", exact: true }).getAttribute("href"), "/projects?view=templates");

  // Given: an unconfigured operator catalog over HTTP.
  await page.goto(`${origin}/pricing`);
  // When: catalog loading completes.
  await page.getByRole("heading", { name: "Hosted plans", exact: true }).waitFor({ state: "visible" });
  // Then: no amount is invented.
  assert.equal(await page.getByText("Not configured", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Unbilled", { exact: true }).count(), 1);

  // Given: the self-hosting page with deployment tabs.
  await page.goto(`${origin}/self-hosting`);
  // When: unavailable artifact tabs are selected.
  await page.getByRole("tab", { name: "Docker Compose", exact: true }).click();
  // Then: future artifacts are explained rather than fake commands.
  assert.equal(await page.getByRole("tabpanel").filter({ hasText: "verified Compose" }).getAttribute("hidden"), null);
  await page.getByRole("tab", { name: "Kubernetes (Helm)", exact: true }).click();
  assert.equal(await page.getByRole("tabpanel").filter({ hasText: "No published Helm" }).getAttribute("hidden"), null);
  await page.getByRole("tab", { name: "Native", exact: true }).click();

  // Given: a filled inquiry and an unavailable support service.
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("UI Test");
  await page.getByRole("textbox", { name: "Work email", exact: true }).fill("ui@example.test");
  await page.getByRole("textbox", { name: "Organization", exact: true }).fill("Test Lab");
  await page.getByRole("textbox", { name: "How can we help?", exact: true }).fill("Verify offline deployment requirements.");
  // When: the real client submits the form over HTTP.
  await page.getByRole("button", { name: "Send inquiry", exact: true }).click();
  await page.getByRole("alert").waitFor({ state: "visible" });
  // Then: the actual error is shown and the form is retained.
  assert.match(await page.getByRole("alert").textContent(), /NOT_IMPLEMENTED/);
  assert.equal(await page.getByRole("textbox", { name: "Name", exact: true }).inputValue(), "UI Test");
  return { landingNavigation: true, unconfiguredCatalog: true, deploymentTabs: true, supportHttpError: true };
}

export async function assertReflow(page) {
  const metrics = await page.evaluate(() => ({
    width: innerWidth, document: document.documentElement.scrollWidth,
    heading: getComputedStyle(document.querySelector("h1")).fontFamily,
    scrollOwners: [...document.querySelectorAll("*")].filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight).map(el => el.className),
  }));
  assert.ok(metrics.document <= metrics.width, `page overflows: ${JSON.stringify(metrics)}`);
  assert.match(metrics.heading, /Source Serif 4/);
  return metrics;
}
