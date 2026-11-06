# IMPORT AND EXPORT INTERCHANGE

## OVERVIEW
Single import/export dispatcher with isolated document conversion; score 9, distinct conversion boundary.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Assembly | `index.ts` | Core delegate installation |
| Contract | `CONTRACT.md`, `README.md` | Route and conversion ownership |
| Imports | `imports.ts` | Import orchestration |
| Exports | `exports.ts` | Export orchestration |
| Uploads | `uploads.ts` | Uploaded inputs |
| Source resolution | `sources.ts` | Import source selection |
| Remote inputs | `remote.ts` | Remote importer |
| URL contributions | `links.ts` | Shared dispatcher |
| Conversion | `converter.ts` | `PandocConverter` |
| Process boundary | `process.ts` | Fixed conversion execution |
| Conversion image | `Dockerfile` | Operator-built tool image |

## CONVENTIONS
- Install core delegates rather than parallel project routes.
- Dispatch remote Git and bibliography links through their actual contributions.
- Conversion tools are fixed by an isolated immutable image.
- Export preparation remains local to the export operation.
- Build the image from the repository root:
  `docker build -t quire-pandoc:local -f services/adapters/interchange/Dockerfile .`
- Verify with `bun test tests/adapters/interchange`.

## ANTI-PATTERNS
- Never execute uploaded scripts or fall back to host conversion.
- Do not add another project-export or source-download route.
- Do not enable fixture loopback origins in production.
- Export must not contact publishers or external accounts.
- Do not claim private Drive OAuth, synchronization or permission bypass.
- Do not enable remote Git's standalone import route in this assembly.
