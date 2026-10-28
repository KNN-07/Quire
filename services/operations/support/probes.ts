import { connect } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ModuleContext } from "@quire/runtime";
import { sandbox, defaultLimits } from "../../../workers/compiler/sandbox";
import { installationRoleSession } from "../installation/launch";

export type Probe = {
  readonly state: "ready" | "degraded" | "missing" | "unconfigured";
  readonly exitCode?: number;
};
const tools = {
  git: ["--version"], latexmk: ["-v"], pdflatex: ["--version"],
  latex: ["--version"], xelatex: ["--version"], lualatex: ["--version"],
  bibtex: ["--version"], biber: ["--version"], synctex: ["--version"],
  bwrap: ["--version"], docker: ["version"], pandoc: ["--version"], Rscript: ["--version"],
} as const;

/** Executes trusted fixed arguments. Output may contain host paths, so it is never exported. */
export async function toolProbes(): Promise<Readonly<Record<string, Probe>>> {
  const entries = await Promise.all(Object.entries(tools).map(async ([name, args]) => {
    const path = Bun.which(name, { PATH: process.env["PATH"] ?? "" });
    if (!path) return [name, { state: "missing" }] as const;
    const child = Bun.spawn([path, ...args], {
      stdin: "ignore", stdout: "ignore", stderr: "ignore", timeout: 5000, killSignal: "SIGKILL",
    });
    const exitCode = await child.exited;
    return [name, { state: exitCode === 0 ? "ready" : "degraded", exitCode }] as const;
  }));
  return Object.fromEntries(entries);
}

export async function portProbe(host: string, port: number): Promise<Probe> {
  return new Promise(resolve => {
    const socket = connect({ host, port });
    const finish = (state: Probe["state"]) => { socket.destroy(); resolve({ state }); };
    socket.once("connect", () => finish("ready"));
    socket.once("error", () => finish("degraded"));
    socket.setTimeout(2000, () => finish("degraded"));
  });
}

/** Executes in the accepted native compiler boundary, not on the host or in an invented profile. */
export async function compilerProbe(): Promise<Probe & { readonly backend: "bwrap" }> {
  const installed = installationRoleSession() !== null;
  const root = await mkdtemp(join(tmpdir(), "quire-p2o-support-probe-"));
  try {
    const result = await sandbox({
      source: root, signal: AbortSignal.timeout(60000), limits: { ...defaultLimits, wallSeconds: 60 },
      installationWork: { kind: "environment-metadata" },
      command: ["/bin/sh", "-c",
        `pdflatex --version && latex --version && xelatex --version && lualatex --version &&
        bibtex --version && biber --version && latexmk -v && synctex --version &&
        printf '%s' '\\documentclass{article}\\begin{document}Quire diagnostic probe.\\end{document}' >/work/probe.tex &&
        cd /work && pdflatex -no-shell-escape -interaction=batchmode -halt-on-error probe.tex &&
        pdfinfo probe.pdf && printf 'QUIRE_SUPPORT_PDF_PROBE_OK\\n'`],
    });
    const verified = result.code === 0 && !result.canceled &&
      new TextDecoder().decode(result.stdout).includes(installed ? "QUIRE_NATIVE_PROBE_OK" : "QUIRE_SUPPORT_PDF_PROBE_OK");
    return { state: verified ? "ready" : "degraded", backend: "bwrap", exitCode: result.code };
  } catch (error) {
    if (error instanceof Error) return { state: "degraded", backend: "bwrap" };
    throw error;
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function runtimeProbes(context: ModuleContext) {
  const database = z.object({ value: z.number() }).parse(await context.db.get("SELECT 1 AS value"));
  const installed = z.array(z.object({ available: z.number(), probe_at: z.string().nullable() }))
    .parse(await context.db.all("SELECT available,probe_at FROM environments WHERE retired_at IS NULL"));
  const project = z.object({ id: z.uuid() }).nullable()
    .parse(await context.db.get("SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY id LIMIT 1"));
  let repository: Probe = { state: "unconfigured" };
  if (project) {
    const { IdSchema } = await import("@quire/contracts");
    try {
      const result = await context.repositories.read(IdSchema.parse(project.id), ["rev-parse", "--is-bare-repository"]);
      repository = { state: new TextDecoder().decode(result).trim() === "true" ? "ready" : "degraded" };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      repository = { state: "degraded" };
    }
  }
  return {
    bun: { version: Bun.version, minimum: "1.3.14", compatible: Bun.semver.satisfies(Bun.version, ">=1.3.14") },
    database: { dialect: context.db.dialect, state: database.value === 1 ? "ready" : "degraded" },
    repository, installedCompilerProfiles: {
      count: installed.length, previouslyProbed: installed.filter(item => item.available === 1 && item.probe_at !== null).length,
      meaning: "Persisted observations only; current availability requires the executed sandbox probe.",
    },
  };
}

/** Configuration metadata, deliberately not a connectivity or provider-credential probe. */
export async function providerConfiguration(context: ModuleContext) {
  const migrated = await context.db.get("SELECT 1 FROM schema_migrations WHERE id=?", ["060-x-shared-adapters"]);
  const rows = migrated ? z.array(z.object({ enabled: z.number(), present: z.number() })).parse(
    await context.db.all("SELECT enabled,CASE WHEN encrypted_secret IS NULL THEN 0 ELSE 1 END AS present FROM adapter_provider_configs")) : [];
  return {
    state: rows.length ? "configured" : "unconfigured", configuredCount: rows.length,
    enabledCount: rows.filter(row => row.enabled === 1).length,
    credentialCount: rows.filter(row => row.present === 1).length,
    connectivity: "not-probed",
  };
}
