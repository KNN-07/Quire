import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvironmentSchema, IdSchema, DigestSchema } from "@quire/contracts";
import type { Environment } from "@quire/contracts";
import { sandbox, defaultLimits } from "../../workers/compiler/sandbox";

export const nativeEnvironmentId = IdSchema.parse("00000000-0000-4000-8000-000000000030");
export async function probeEnvironment(signal?: AbortSignal): Promise<Environment> {
  const root = await mkdtemp(join(tmpdir(), "quire-toolchain-"));
  try {
    const result = await sandbox({ source: root, limits: defaultLimits,
      ...(signal ? { signal } : {}), command: ["/bin/sh", "-c",
      `pdflatex --version && latex --version && xelatex --version && lualatex --version &&
      bibtex --version && biber --version && latexmk -v && synctex --version &&
      sha256sum /usr/bin/pdftex /usr/bin/xetex /usr/bin/luahbtex /usr/bin/latexmk /usr/bin/biber /usr/bin/bibtex.original /etc/LatexMk &&
      printf '%s' '\\documentclass{article}\\begin{document}Environment probe.\\end{document}' >/work/probe.tex &&
      find /usr/share/texlive/texmf-dist /usr/share/texmf /etc/texmf /var/lib/texmf -type f -print0 |
        sort -z | xargs -0 sha256sum | sha256sum &&
      cd /work && pdflatex -no-shell-escape -interaction=batchmode -halt-on-error probe.tex >&2 &&
      pdfinfo probe.pdf >&2 && printf 'QUIRE_NATIVE_PROBE_OK\\n'`] });
    const digest = DigestSchema.parse(new Bun.CryptoHasher("sha256").update(result.stdout).digest("hex"));
    const release = /TeX Live (\d+)/.exec(new TextDecoder().decode(result.stdout))?.[1] ?? "unknown";
    return EnvironmentSchema.parse({ id: nativeEnvironmentId, label: `texlive-${release}-native`,
      release, backend: "bwrap", rootOrImageDigest: `native:${digest}`,
      engines: ["pdflatex", "latex", "xelatex", "lualatex", "plain"], helpers: ["bibtex", "biber", "synctex"],
      packagesDigest: digest, experimental: false, available: !result.canceled && result.code === 0 &&
        new TextDecoder().decode(result.stdout).includes("QUIRE_NATIVE_PROBE_OK"), probeAt: new Date().toISOString() });
  } finally { await rm(root, { recursive: true, force: true }); }
}
