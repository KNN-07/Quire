import { existsSync } from "node:fs";
import { join } from "node:path";
import { ControlError } from "./model";
import type { ExecutionTask } from "./execution-model";

const runtimePaths = [
  "/usr/bin", "/usr/lib", "/usr/lib64", "/usr/libexec", "/usr/share/texlive",
  "/usr/share/texmf", "/usr/share/fonts", "/usr/share/fontconfig", "/usr/share/ghostscript",
  "/usr/share/perl5", "/usr/share/perl", "/usr/share/latexmk", "/usr/share/poppler",
  "/usr/share/zoneinfo", "/etc/texmf", "/etc/fonts", "/etc/ld.so.cache", "/etc/paperspecs",
  "/etc/ghostscript", "/etc/alternatives/bibtex", "/etc/LatexMk", "/var/lib/texmf", "/var/cache/fontconfig",
];
/** All command text is fixed here; callers supply only parsed recipe arguments. */
export function executionRecipe(task: ExecutionTask): readonly string[] {
  const work = task.request.work;
  switch (work.kind) {
    case "compile": {
      if (task.profile.backend === "docker") return ["/usr/local/bin/quire-compile", task.profile.profile,
        work.engine, work.mainFile, String(work.stopOnFirstError), String(work.draft)];
      const flags = {
        pdflatex: ["-pdf"], latex: ["-pdfdvi"], xelatex: ["-xelatex"], lualatex: ["-lualatex"],
        plain: ["-pdf", "-pdflatex=pdftex %O %S"],
      }[work.engine];
      const projectRc = task.source && existsSync(join(task.source, ".latexmkrc")) ? ".latexmkrc" :
        task.source && existsSync(join(task.source, "latexmkrc")) ? "latexmkrc" : null;
      return ["/bin/sh", "-c",
        'latexmk "$@" >&2; code=$?; if [ "$code" = 0 ]; then mkdir -p /work/.validation; pdfinfo /work/output.pdf >&2 && pdftoppm -scale-to 16 /work/output.pdf /work/.validation/page >&2 || code=65; fi; printf "%s" "$code" >/work/exit-code; cd /work; tar --format=ustar -cf - -- *; exit "$code"',
        "compile", "-norc", ...(existsSync("/etc/LatexMk") ? ["-r", "/etc/LatexMk"] : []),
        "-e", '$dvipdf="dvipdfmx %O -o %D %S"', ...(projectRc ? ["-r", `/src/${projectRc}`] : []),
        ...flags, "-interaction=nonstopmode", "-file-line-error", "-synctex=1", "-recorder",
        "-outdir=/work", "-jobname=output", "-latexoption=-no-shell-escape",
        ...(work.stopOnFirstError ? ["-halt-on-error"] : []),
        ...(work.draft ? ["-pretex=\\PassOptionsToPackage{draft}{graphicx}", "-usepretex"] : []), `/src/${work.mainFile}`];
    }
    case "synctex-forward": return ["synctex", "view", "-i", `${work.line}:${work.column}:/src/${work.file}`, "-o", "/src/output.pdf"];
    case "synctex-reverse": return ["synctex", "edit", "-o", `${work.page}:${work.xPt}:${work.yPt}:/src/output.pdf`];
    case "pdf-validate": return ["pdftoppm", "-scale-to", "16", `/src/${work.file}`, "/work/validation"];
    case "pdf-diff-render": return ["/bin/sh", "-c",
      "pdftoppm -r 72 /src/from.pdf /work/from >&2 && pdftoppm -r 72 /src/to.pdf /work/to >&2 && pdftoppm -png -r 72 /src/from.pdf /work/from >&2 && pdftoppm -png -r 72 /src/to.pdf /work/to >&2 && cd /work && tar --format=ustar -cf - -- *.ppm *.png"];
    case "pdf-diff-compile": return ["/bin/sh", "-c",
      "pdflatex -no-shell-escape -interaction=nonstopmode -halt-on-error -output-directory=/work /src/diff.tex >&2 && pdftoppm -f 1 -l 1 -singlefile -png -scale-to 1600 /work/diff.pdf /work/comparison >&2 && cd /work && tar --format=ustar -cf - diff.pdf comparison.png"];
    case "environment-metadata":
      return task.profile.backend === "docker"
        ? ["/bin/sh", "-ec", "pdflatex --version; sha256sum /opt/quire/packages.tsv; latexminted --version; Rscript --vanilla -e 'cat(as.character(getRversion()), as.character(packageVersion(\"knitr\")))'"]
        : ["/bin/sh", "-c",
          `pdflatex --version && latex --version && xelatex --version && lualatex --version &&
          bibtex --version && biber --version && latexmk -v && synctex --version &&
          sha256sum /usr/bin/pdftex /usr/bin/xetex /usr/bin/luahbtex /usr/bin/latexmk /usr/bin/biber /usr/bin/bibtex.original /etc/LatexMk &&
          printf '%s' '\\documentclass{article}\\begin{document}Environment probe.\\end{document}' >/work/probe.tex &&
          find /usr/share/texlive/texmf-dist /usr/share/texmf /etc/texmf /var/lib/texmf -type f -print0 |
            sort -z | xargs -0 sha256sum | sha256sum &&
          cd /work && pdflatex -no-shell-escape -interaction=batchmode -halt-on-error probe.tex >&2 &&
          pdfinfo probe.pdf >&2 && printf 'QUIRE_NATIVE_PROBE_OK\\n'`];
    case "environment-confinement":
      return ["/bin/sh", "-ec", task.profile.backend === "docker"
        ? `test "$(id -u)" = 65534; test ! -w /usr; test ! -w /src; test ! -S /var/run/docker.sock; test ! -e /home/norman; grep -q 'NoNewPrivs:[[:space:]]*1' /proc/self/status; grep -q 'Seccomp:[[:space:]]*2' /proc/self/status; test "$(cat /sys/fs/cgroup/pids.max)" = ${task.request.limits.processes}; test "$(cat /sys/fs/cgroup/memory.max)" = ${task.request.limits.memoryBytes}; test "$(cat /sys/fs/cgroup/memory.swap.max)" = 0; test "$(wc -l </proc/net/route)" = 1; printf 'CONFINEMENT_OK\\n'`
        : "test ! -w /usr; test ! -w /src; test ! -e /home; test ! -S /run/user/1000/bus; test \"$(wc -l </proc/net/route)\" = 1; printf 'CONFINEMENT_OK\\n'"];
    case "environment-fixture": return ["/usr/local/bin/quire-compile", task.profile.profile, work.engine, work.mainFile];
    case "environment-fonts": return ["/bin/sh", "-ec", "for f in /src/fonts/*; do fc-scan --format '%{family}\\n' \"$f\" || exit 65; done"];
    case "environment-build": return ["/bin/sh", "-ec",
      'mirror=$1; shift; mkdir -p /usr/local/share/fonts/quire; cp -a /src/fonts/. /usr/local/share/fonts/quire/; if [ "$#" -gt 0 ]; then rm -f /etc/apt/sources.list /etc/apt/sources.list.d/*; printf "Types: deb\\nURIs: %s\\nSuites: resolute resolute-updates resolute-security\\nComponents: main universe\\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\\n" "$mirror" >/etc/apt/sources.list.d/quire.sources; apt-get -o Acquire::ForceIPv4=true -o Acquire::https::AllowRedirect=false -o Acquire::http::AllowRedirect=false update; apt-get -o Acquire::ForceIPv4=true -o Acquire::https::AllowRedirect=false -o Acquire::http::AllowRedirect=false install -y --no-install-recommends "$@"; rm -rf /var/lib/apt/lists/*; fi; fc-cache -f; mkdir -p /opt/quire; (dpkg-query -W; find /usr/local/share/fonts/quire -type f -exec sha256sum {} \\;) >/opt/quire/packages.tsv',
      "environment-build", work.mirror, ...work.packages];
    case "worker": throw new ControlError("CONTROL_WORKER_FACTORY_REQUIRED");
  }
  throw new ControlError("CONTROL_EXECUTION_KIND_DENIED");
}
export function nativeExecutionCommand(task: ExecutionTask): readonly string[] {
  if (!task.source) throw new ControlError("CONTROL_EXECUTION_SOURCE_REQUIRED");
  return ["/usr/bin/bwrap", "--unshare-all", "--unshare-user", "--disable-userns", "--die-with-parent", "--new-session",
    "--cap-drop", "ALL", "--clearenv", "--setenv", "PATH", "/usr/bin", "--setenv", "HOME", "/nonexistent",
    "--setenv", "LANG", "C.UTF-8", "--setenv", "TMPDIR", "/work/tmp",
    "--setenv", "XDG_CACHE_HOME", "/work/cache", "--setenv", "TEXMFVAR", "/work/texmf-var",
    "--setenv", "TEXMFCONFIG", "/work/texmf-config", "--setenv", "TEXINPUTS", "/src//:", "--setenv", "BIBINPUTS", "/src//:",
    ...runtimePaths.filter(path => existsSync(path)).flatMap(path => ["--ro-bind", path, path]),
    "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
    "--ro-bind", task.source, "/src", "--proc", "/proc", "--dev", "/dev", "--remount-ro", "/dev",
    "--size", String(task.request.limits.workspaceBytes), "--tmpfs", "/work", "--symlink", "/work/tmp", "/tmp",
    "--remount-ro", "/", "--chdir", "/src", "--", "/bin/sh", "-c", 'mkdir -p /work/tmp; exec "$@"', "quire",
    ...executionRecipe(task)];
}
