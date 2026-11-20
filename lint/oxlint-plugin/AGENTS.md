# LOCAL OXLINT RULES

## OVERVIEW
Repository-specific oxlint plugin enforcing product-copy and suppression conventions; score 8, distinct lint policy domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Plugin registry | `index.js` | Named rule registration |
| Product copy rule | `no-em-dash-copy.js` | String, template and JSX text |
| Suppression rule | `require-suppression-reason.js` | Directive rationale checks |
| License | `LICENSE` | Upstream port attribution |
| Plugin configuration | `../../.oxlintrc.json` | Rule activation and settings |
| Project checks | `../../package.json` | Lint command wiring |
| CI lint step | `../../.github/workflows/ci.yml` | Automated repository check |
| Rule test references | `../../tests/` | Existing lint and source checks |
| Repository policy | `../../AGENTS.md` | Product-copy convention |

## CONVENTIONS
- Export rules through the single plugin registry and configure them in root oxlint settings.
- Keep diagnostics actionable and scoped to source constructs users read.

## ANTI-PATTERNS
- Do not weaken rules to ignore existing violations.
- Do not add suppression directives without a reason.
- Product-facing copy must not contain em dashes.
- Do not register duplicate aliases for the same local rule.
- Preserve upstream license attribution when changing ported rule behavior.
- Keep rule behavior aligned with configured oxlint visitor APIs.
- Report violations at the source node that needs correction.
