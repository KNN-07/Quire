import { createRuntime } from "./context";
import { loadConfig } from "./config";

if (import.meta.main) {
  const runtime = await createRuntime(loadConfig());
  try {
    console.info(JSON.stringify({
      runtime: { bun: Bun.version, minimum: "1.3.14", database: "sqlite", dataDir: runtime.config.dataDir },
      tools: Object.fromEntries(["git", "latexmk", "pdflatex", "xelatex", "lualatex", "biber", "bibtex", "bwrap", "docker", "pandoc"].map((tool) => [tool, Bun.which(tool)])),
      sandbox: { state: "unconfigured", reason: "Compiler lane must verify sandbox and process-tree containment; tool presence is not a probe" },
      environments: await runtime.db.all("SELECT id,label,available,probe_at FROM environments"),
      providers: { state: "unconfigured", reason: "No provider configured by foundation" },
    }, null, 2));
  } finally { await runtime.close(); }
}
