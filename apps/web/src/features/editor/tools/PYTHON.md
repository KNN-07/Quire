# Browser Python installation contract

This extension is disabled by default. It does not install software on the TeX
server and does not claim a configured external Python service.

The deployment owner must pin and install the official Pyodide core runtime and
standard library, then serve matching assets from a same-origin directory.
The parent now provisions `pyodide@314.0.7` at `/extensions/pyodide/` through
`bun run assets:python` and the root postinstall/dev/build hooks.
That directory contains `pyodide.mjs`, its matching JavaScript/WASM runtime,
lockfile and standard library. `version.json` reports the installed version and
asset names. This is not every scientific wheel: missing optional imports fail
visibly, and the tools worker does not install them automatically.
Serve WASM with its correct MIME type. Do not mix files from different releases.
The root dependency/static-asset copy step belongs to the parent; no dependency
or public directory outside the tools boundary is changed here.

Open Browser Python, enter that directory URL (with a trailing slash), enter the
exact installed `pyodide.version` string, enable the extension, and save. These
choices are local to this browser. A new module worker imports the installed
loader only after Run. It checks the returned version before executing code.
Missing assets, wrong versions, Python exceptions and timeouts are visible
errors, never successful empty runs. Cancel terminates the owned worker.

Select a project `.py` file. The saved script and explicitly selected input
files are read through the injected authorized client. Inputs are copied to
`/inputs/<project-relative-path>`. Scripts should write their output to
`/outputs/<project-relative-path>`; nested directories are supported. The browser
worker can use browser networking. It has no host filesystem or TeX service.
It starts fresh for each run and is terminated on completion, failure or cancel.

Only regular output files are accepted, up to 20 files and 5 MiB in total.
Symlinks, special files and invalid project paths fail. Console output is bounded.
The result lists exact output paths and byte sizes, exposes bytes and full
downloads for inspection, and requires a
checkbox per approved output before Save approved files. Execution itself
performs no project mutation. Approval uses the ordinary versioned upload
endpoint and role checks; Viewer cannot save outputs.
The current upload API adds files, not replacements. A generated path that
already exists cannot be approved until the user chooses a new destination.
No delete-and-recreate overwrite sequence is invented.

Reference mechanism: the official Pyodide worker guide,
`https://pyodide.org/en/stable/usage/webworker.html`, and the installed runtime's
`loadPyodide`, `runPythonAsync`, `setStdout`, `setStderr`, and Emscripten FS API.
The worker uses an ES module worker, not classic `importScripts`.

Installed-runtime execution and generated-file approval are tested through the
same-origin asset directory. A missing runtime is an installation prerequisite,
not a pass.
