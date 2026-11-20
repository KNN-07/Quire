# COMPILER IMAGE

## OVERVIEW
Owned compiler toolchain image, fixed wrappers and acceptance fixtures; score 10, distinct isolated execution domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Image definition | `Dockerfile` | Compiler toolchain build |
| Main wrapper | `compile.sh` | Profile and engine selection |
| TikZ wrapper | `tikz.sh` | Generated basename handling |
| Acceptance inputs | `fixtures/` | Positive and forbidden examples |
| Air-gap inventory | `../runtime/manifest.ts` | Release artifact identity |
| Environment registry | `../../services/operations/environments/` | Profile and execution admission |
| Worker execution | `../../workers/compiler/` | Controlled sandbox caller |
| Image role dispatch | `../runtime/entrypoint.sh` | Runtime process separation |
| Build procedure | `../../docs/runbooks/toolchains.md` | Immutable image inspection |
| Acceptance suites | `../../tests/compiler/` | Fixture-bound output checks |
| Air-gap inventory | `../../scripts/ops/airgap.ts` | Signed artifact and image inventory |

## CONVENTIONS
- Build toolchains into owned images rather than discovering host executables.
- Keep wrapper commands fixed and validate profile, engine and input names.
- Fixtures establish bounded behavior for specific compiler profiles.
- Ready environments can be selected for unmanaged execution; controlled installation roles require signed release admission.
- Air-gap inventory is a separate artifact and does not grant execution.

## ANTI-PATTERNS
- Never provide an unsandboxed host fallback or placeholder PDF.
- Do not accept caller-supplied shell options through wrapper arguments.
- Do not claim general compiler acceptance from a single fixture.
- Do not rely on host PATH discovery for compiler tools.
- Do not treat image build success as signed admission for controlled roles.
- Keep generated files and caches inside the isolated work directory.
- Do not silently enable shell escape for a fixture or profile.
