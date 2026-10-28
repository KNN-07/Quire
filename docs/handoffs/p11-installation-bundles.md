# Installation build entrypoints: FINAL scoped packaging

October 28, 2026. Parent-owned package/documentation change.

`bun run build:installation` now emits these real Bun-target entrypoints:

- `dist/installation/installation-main.js`: stable controller, operator
  status/recovery and controller-owned role dispatch.
- `dist/installation/installation-role.js`: signed role and worker factories.
- `dist/installation/ssh.js`: signed SSH proxy CLI.

The full product build invokes this command after the existing bundles.
`installation:controller`, `installation:status` and `installation:recover`
package scripts dispatch to the built CLI. README and the installation runbook
describe the artifacts and distinguish checkout commands from an independently
installed, digest-pinned stable launcher. These commands do not bootstrap
control authority or authorize deployment.

`mon_VM0XVVQMPN31R0W1` completed `./node_modules/.bin/bun run
build:installation` with exit 0: 681 modules for controller/factories and 319
for SSH; outputs approximately 0.99 MB, 3.59 MB and 0.96 MB respectively.

The built-module smoke check imported both factory exports, verified all three
package commands reject missing arguments with exit 1 / `CONTROL_ARGUMENTS`,
and invoked the built SSH CLI's pure configuration renderer. It returned exit 0
with the requested port and the actual bundled SSH path. The smoke command
completed exit 0 under `mon_AD0M2XDESWZ8FJ1M`.
An earlier smoke command had a JavaScript regex-escaping syntax error before
executing assertions; that was corrected in the command, not production code.

The package JSON LSP could not run because its configured Biome executable is
not installed. Bun successfully parsed the package and executed its scripts.
No new dependency, process listener, installation, unit or private root was
created by the smoke check.

This accepts the packaging command, not all-role installation behavior.
Driver/caller work is still in progress, so the final full-product build must
regenerate these bundles from settled sources before any release handoff.
