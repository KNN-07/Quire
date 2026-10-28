import { installPythonAssets } from "./python-assets";
import { installSpellingAssets } from "./spelling-assets";

await Promise.all([installPythonAssets(), installSpellingAssets()]);
const children = [
  Bun.spawn(["bun", "--watch", "apps/server/src/main.ts"], { stdout: "inherit", stderr: "inherit" }),
  Bun.spawn(["node", "node_modules/vite/bin/vite.js", "--config", "apps/web/vite.config.ts"], { stdout: "inherit", stderr: "inherit" }),
];
const interrupted = new Promise<number>((resolve) => {
  process.once("SIGINT", () => { resolve(0); });
  process.once("SIGTERM", () => { resolve(0); });
});
const code = await Promise.race([interrupted, ...children.map((child) => child.exited)]);
for (const child of children) child.kill("SIGTERM");
await Promise.all(children.map((child) => child.exited));
process.exitCode = code;
