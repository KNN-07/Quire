import { assertNever, EnvironmentSchema, ProjectPathSchema } from "@quire/contracts";
import type { Environment } from "@quire/contracts";
import { dockerSandbox } from "../../../workers/compiler/docker";
import { defaultLimits } from "../../../workers/compiler/sandbox";
import { readTar } from "../../../workers/compiler/archive";
import { ImageSchema, ProbeReportSchema, profileHelpers } from "./model";
import type { Profile, ProbeReport } from "./model";
import { fixtureSource } from "./fixtures";

const limits = { ...defaultLimits, wallSeconds: 90 };
export type FixtureResult = {
  readonly code: number; readonly files: ReadonlyMap<string, Uint8Array>;
  readonly log: string; readonly text: string;
};
export async function compileFixture(image: string, input: {
  readonly fixture: string; readonly profile: Profile; readonly engine: Environment["engines"][number];
  readonly signal?: AbortSignal;
}): Promise<FixtureResult> {
  await using source = await fixtureSource(input.fixture);
  const result = await dockerSandbox({ image, source: source.path, limits,
    installationProfile: input.profile,
    installationWork: { kind: "environment-fixture", engine: input.engine, mainFile: ProjectPathSchema.parse("main.tex") },
    ...(input.signal ? {signal:input.signal} : {}),
    command: ["/usr/local/bin/quire-compile", input.profile, input.engine, "main.tex"] });
  const files = readTar(result.stdout);
  return { code: result.code, files, log: result.stderr,
    text: new TextDecoder().decode(files.get("output.txt")) };
}
/** Availability is the conjunction of actual compilation, content and
 * confinement checks, never discovery of executables in PATH. */
export async function probeImage(image: string, profile: Profile, signal?: AbortSignal): Promise<ProbeReport> {
  ImageSchema.parse(image);
  const checks: ProbeReport["checks"] = [];
  await using source = await fixtureSource("engines");
  const metadata = await dockerSandbox({ image, source: source.path, limits,
    installationProfile: profile, installationWork: { kind: "environment-metadata" },
    ...(signal ? {signal} : {}),
    command: ["/bin/sh", "-ec", "pdflatex --version; sha256sum /opt/quire/packages.tsv; latexminted --version; Rscript --vanilla -e 'cat(as.character(getRversion()), as.character(packageVersion(\"knitr\")))'"] });
  const output = new TextDecoder().decode(metadata.stdout);
  checks.push({ name: "metadata", code: metadata.code, detail: output + metadata.stderr });
  const release = /TeX Live (\d+)/.exec(output)?.[1] ?? "unknown";
  const packagesDigest = /([a-f0-9]{64})\s+\/opt\/quire\/packages.tsv/.exec(output)?.[1] ?? "0".repeat(64);
  const run = async (fixture: string, engine: Environment["engines"][number], text: string) => {
    const result = await compileFixture(image, { fixture, engine, profile, ...(signal ? {signal} : {}) });
    const pdf = result.files.get("output.pdf");
    const valid = result.code === 0 && pdf && new TextDecoder().decode(pdf.subarray(0,5)) === "%PDF-" &&
      result.text.includes(text);
    const bibliography = fixture !== "bibtex" && fixture !== "biber" || result.files.has("output.bbl");
    const external = fixture !== "tikz" || result.files.has("output-figure0.pdf") && result.files.has("output-figure1.pdf");
    const escaped = result.files.has("forbidden-escape");
    checks.push({ name: `${fixture}:${engine}`, code: valid && bibliography && external && !escaped ? 0 : result.code || 65,
      detail: result.log.slice(-12000) });
  };
  for (const engine of ["pdflatex", "latex", "xelatex", "lualatex"] as const) await run("engines", engine, "Quire real engine");
  await run("plain", "plain", "Quire plain TeX");
  for (const engine of ["xelatex", "lualatex"] as const) await run("fonts", engine, "Quire Unicode");
  await run("bibtex", "pdflatex", "Quire Bibliography Evidence");
  await run("biber", "pdflatex", "Quire Bibliography Evidence");
  await run("escape", "pdflatex", "Quire forbidden");
  switch (profile) {
    case "default": break;
    case "restricted":
      await run("minted", "pdflatex", "Quire lexer content");
      await run("tikz", "pdflatex", "Quire external");
      break;
    case "knitr":
      await run("knitr", "pdflatex", "Computed result: 55");
      break;
    default: assertNever(profile);
  }
  const security = await dockerSandbox({ image, source: source.path, limits,
    installationProfile: profile, installationWork: { kind: "environment-confinement" },
    ...(signal ? {signal} : {}),
    command: ["/bin/sh", "-ec", `test "$(id -u)" = 65534; test ! -w /usr; test ! -w /src; test ! -S /var/run/docker.sock; test ! -e /home/norman; grep -q 'NoNewPrivs:[[:space:]]*1' /proc/self/status; grep -q 'Seccomp:[[:space:]]*2' /proc/self/status; test "$(cat /sys/fs/cgroup/pids.max)" = 128; test "$(cat /sys/fs/cgroup/memory.max)" = 1073741824; test "$(cat /sys/fs/cgroup/memory.swap.max)" = 0; test "$(cat /sys/fs/cgroup/cpu.max)" = '100000 100000'; test "$(wc -l </proc/net/route)" = 1; printf 'CONFINEMENT_OK\\n'; cat /sys/fs/cgroup/pids.max /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max`] });
  checks.push({ name: "confinement", code: security.code, detail: new TextDecoder().decode(security.stdout) + security.stderr });
  return ProbeReportSchema.parse({ image, profile, release, packagesDigest, at: new Date().toISOString(),
    available: checks.every(check => check.code === 0), checks });
}

export function manifestFromProbe(input: {
  readonly id: string; readonly label: string; readonly report: ProbeReport;
}): Environment {
  const helpers = profileHelpers[input.report.profile];
  return EnvironmentSchema.parse({ id: input.id, label: input.label, release: input.report.release,
      backend: "docker", rootOrImageDigest: input.report.image,
      engines: ["pdflatex","latex","xelatex","lualatex","plain"], helpers,
      packagesDigest: input.report.packagesDigest,
      experimental: true, available: input.report.available, probeAt: input.report.at });
}
