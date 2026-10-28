import { loadConfig, createRuntime } from "@quire/runtime";
import { createScaleAdapters } from "../../apps/server/src/scale";
import { toolProbes, compilerProbe, portProbe, runtimeProbes, providerConfiguration, migrations } from "../../services/operations/support";
import type { ModuleContext } from "@quire/runtime";

/** No provider is mandatory for native operation; installed tools are not compiler availability. */
export async function doctor(context: ModuleContext) {
  const [runtime, tools, sandbox, port, providers] = await Promise.all([
    runtimeProbes(context), toolProbes(), compilerProbe(), portProbe(context.config.host, context.config.port),
    providerConfiguration(context),
  ]);
  const requiredTools = ["git", "latexmk", "pdflatex", "latex", "xelatex", "lualatex", "bibtex", "biber", "synctex", "bwrap"];
  const requiredReady = runtime.bun.compatible && runtime.database.state === "ready" &&
    runtime.repository.state !== "degraded" && sandbox.state === "ready" &&
    requiredTools.every(name => tools[name]?.state === "ready");
  return {
    requiredNative: { state: requiredReady ? "ready" : "degraded", runtime,
      tools: Object.fromEntries(requiredTools.map(name => [name, tools[name]])), sandbox },
    optionalInstalled: Object.fromEntries(["docker", "pandoc", "Rscript"].map(name => [name, tools[name]])),
    optionalProviders: providers,
    apiPort: { ...port, requiredForOfflineDoctor: false },
    compilerProfiles: runtime.installedCompilerProfiles,
  };
}

if (import.meta.main) {
  const config = loadConfig();
  const runtime = await createRuntime(config, {
    modules: [{ id: "085-o-support-schema", lane: "O", order: 85, migrations, register() {} }],
    ...(config.profile === "scale" ? { createAdapters: createScaleAdapters } : {}),
  });
  try {
    const report = await doctor({ ...runtime, routes: runtime.routes.forLane("O") });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.requiredNative.state === "ready" ? 0 : 1;
  } finally { await runtime.close(); }
}
