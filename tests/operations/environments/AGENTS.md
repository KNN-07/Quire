# ENVIRONMENT ADMISSION TESTS

## OVERVIEW
Compiler image profiles, probes, admission, and confinement; score 8, distinct executable environment domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Image identity | `image.ts` | `ownedImage`, `verifiedReport` |
| Runtime setup | `harness.ts` | `environmentFixture` |
| Profile inputs | `input.ts` | `profileInput` |
| Role preparation | `admission-role.ts` | Installation admission role |
| Actual profile execution | `profiles.test.ts` | Default/restricted/knitr probes |
| Confinement and font limits | `security.test.ts` | Security-related profiles |
| Events and errors | `events.ts`, `error.ts` | Shared response helpers |

## CONVENTIONS
- The owned Docker image is inspected before fixture image selection.
- Its current tag is `quire-p2o-environments:st_01a17c2c`.
- `QUIRE_TEST_ENVIRONMENT_IMAGE` can override the selected parsed image identity.
- `verifiedReport` caches an in-flight probe per profile.
- Any unavailable report throws with the names of failing real checks.
- Profile acceptance executes each full fixture inventory serially.
- Evidence includes profile JSON reports plus actual generated PDF/text artifacts.
- Profile tests expect TeX release `2025`.
- The profile suite has a long explicit execution budget for real engine work.
- Tagged output uses LuaLaTeX; ordinary engine coverage also exercises pdfLaTeX.

## ANTI-PATTERNS
- Use the independently built owned image instead of host PATH discovery.
- Uploaded fonts using fontspec are incompatible with pdfLaTeX.
- Availability claims must follow successful real probe checks.
- Sources: `profiles.test.ts`, `security.test.ts`, `image.ts`.
