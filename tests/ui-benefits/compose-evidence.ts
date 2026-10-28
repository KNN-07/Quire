import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { startEditorBrowser } from "../ui-editor/shared";

const directory = "docs/evidence/p4-benefits-controls";
const names = (await readdir(directory)).filter(name => name.endsWith(".png")
  && !name.includes("-pair") && !name.startsWith("contact-")).sort();
const captures = [];
for (const name of names) {
  const bytes = await readFile(join(directory, name));
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new TypeError(`Invalid PNG signature: ${name}`);
  }
  captures.push({ name, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
    data: bytes.toString("base64") });
}
await using browser = await startEditorBrowser();
const context = await browser.browser.newContext({ viewport: { width: 1480, height: 1000 } });
try {
  const page = await context.newPage();
  for (let offset = 0; offset < captures.length; offset += 4) {
    const batch = captures.slice(offset, offset + 4);
    await page.setContent(`<html><head><style>
      body{margin:0;padding:16px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;font:14px sans-serif;background:#ddd}
      figure{margin:0;min-width:0}figcaption{padding:8px;background:white;color:black}
      img{display:block;width:100%;height:900px;object-fit:contain;object-position:top;background:#bbb}
      </style></head><body>${batch.map(capture => `<figure><figcaption>${capture.name} (${capture.width} × ${capture.height})</figcaption><img src="data:image/png;base64,${capture.data}"></figure>`).join("")}</body></html>`);
    await page.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); });
    await page.screenshot({ path: join(directory, `contact-${String(offset / 4 + 1).padStart(2, "0")}.png`), fullPage: true });
  }
  for (const width of [390, 1440, 1920]) {
    for (const theme of ["light", "dark"]) {
      for (const surface of ["admin", "share"]) {
        const prefix = `${surface}-${width}-${theme}`;
        const before = captures.find(capture => capture.name === `${prefix}-before.png`);
        const after = captures.find(capture => capture.name === `${prefix}-after.png`);
        if (!before || !after) throw new TypeError(`Missing baseline pair: ${prefix}`);
        await page.setContent(`<html><head><style>body{margin:0;font:14px sans-serif}h1{font-size:14px;padding:8px;margin:0}main{display:flex}img{display:block;width:50%;height:auto;align-self:start}</style></head><body><h1>${prefix}: before (left), after (right)</h1><main><img src="data:image/png;base64,${before.data}"><img src="data:image/png;base64,${after.data}"></main></body></html>`);
        await page.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); });
        await page.screenshot({ path: join(directory, `${prefix}-pair.png`), fullPage: true });
        const command = Bun.spawn(["node", "/home/norman/.omo/binary-runtime/5.1.48/plugin/skills/visual-qa/scripts/visual-qa.mjs",
          "image-diff", join(directory, before.name), join(directory, after.name)], { stdout: "pipe", stderr: "pipe" });
        const [output, diagnostic, code] = await Promise.all([
          new Response(command.stdout).text(), new Response(command.stderr).text(), command.exited,
        ]);
        if (code !== 0) throw new TypeError(`Image diff failed: ${diagnostic}`);
        await Bun.write(join(directory, `${prefix}-diff.json`), output);
      }
    }
  }
} finally { await context.close(); }
await Bun.write(join(directory, "capture-index.json"), JSON.stringify(
  captures.map(({ name, width, height }) => ({ name, width, height })), null, 2) + "\n");
console.info(`Validated ${captures.length} PNG captures; composed ${Math.ceil(captures.length / 4)} contact sheets and 12 baseline pairs.`);
