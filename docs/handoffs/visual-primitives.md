# Shared visual primitives

Implementation scope: UI infrastructure, not product routes. Import components from
`apps/web/src/ui` and load `apps/web/src/styles/global.css` once at the application entry.

## Brief

Primary action in the verification surface: Save changes. Information priorities:
form content, view controls, secondary/status actions. Required content: Quire mark,
header title/actions, labeled name/email inputs, hint/error, all button variants,
icon control, three tabs including disabled, empty state, spinner, toast, modal.
Left out on purpose: metrics, promotional badges, decorative colored edges, app data.

Layout: shared header - keep identity and actions readable -> cluster
(https://raw.githubusercontent.com/changeroa/StyleGallery/main/patterns/in-line-grouping/cluster.md);
scroll owner: document; anti-patterns: nonwrapping actions and unbreakable titles.
Layout: modal - bounded centered overlay -> imposter
(https://raw.githubusercontent.com/changeroa/StyleGallery/main/patterns/overlay-exceptions/imposter.md);
scroll owner: .q-modal; anti-patterns: overflowing viewport or scrolling background.

## Public contract

All exports are named. Components accept ordinary React/HTML attributes unless
the explicit props below replace a conflicting attribute. No router, API, or app
state is imported.

| Export | Element / explicit props |
| --- | --- |
| `BrandMark` | span; `wordmark?: boolean` (true). Hidden Quire name when false. |
| `Button` | button, forwarded ref; `variant?: neutral\|primary\|dark\|ai\|success\|danger\|ghost`, `size?: small\|regular\|large`, `busy?: boolean`. Defaults neutral/regular/type=button; busy disables and announces Working. |
| `IconButton` | Button with ref; required `label: string`, `icon: IconName`; no children/aria-label override. Label supplies accessible name and native title tooltip. |
| `Field` | input with ref; required `label: ReactNode`; `hint?`, `error?` ReactNode. Wrapper receives className; other input props go to input. Generated id unless supplied. Error sets aria-invalid and linked description. |
| `Tabs` | div; `label: string`, `items: readonly TabItem[]`, `value?`, `defaultValue?`, `onValueChange?(value: string)`. Item: unique value, label, content, optional disabled. Horizontal automatic activation; arrows wrap and skip disabled, Home/End; RTL-aware. Controlled values must name an enabled item. |
| `Modal` | dialog; `open: boolean`, `onClose(): void`, `title: ReactNode`, `description?`, `footer?`, `size?: regular\|wide`, `closeLabel?`. Caller sets open=false when dismissed. Native showModal inerts siblings; explicit Tab/Shift+Tab wrapping prevents focus escaping to browser chrome; Escape requests close; cleanup closes, restores body overflow and returns focus. Use React `autoFocus` on the desired input when needed. |
| `EmptyState` | div; `title: ReactNode`, `description?`, `action?`, `icon?: IconName`. No implied data state. |
| `Spinner` | span/status; `label?: string` (Loading). Reduced-motion static dotted ring plus text. |
| `ToastRegion` | div; `toasts: readonly Toast[]`, `onDismiss?(id)`, `dismissLabel?`. Toast has id/message/tone? neutral\|success\|error. Polite status for normal notices, alert for errors. Caller owns lifetime; no timing-based auto-dismiss. |
| `Icon` | SVG; `name: IconName`, `size?: number` (16). Decorative by default; name the containing action. Standard SVG attributes available. |
| `AppHeader` | header/ref; `brand?: ReactNode` (BrandMark), `actions?: ReactNode`, children as breadcrumb/title. Intrinsic wrapping, no routing assumptions. |

All corresponding `*Props` interfaces, `IconName`, `TabItem`, and `Toast` are
exported as types. Icon names: plus, close, chevronDown, chevronRight, check,
search, file, folder, branch, sparkle, play, download, settings, warning, info,
menu, arrowLeft. Inline SVG strokes avoid a dependency on an icon package.

## Design decisions

Exact light palette, 13px chrome, 34px toolbar controls, 40px inputs, 56px wrapping
header, 620/820px dialogs, radii and spacing follow `docs/discovery/design.md`.
Dark/system is an accessible derived ramp, not a supplied reference. Set
`data-theme="light"` or `"dark"` on html; absent or `"system"` follows the OS.
Set the attribute on html, not a nested region, for consistent system override.
Dark solid actions invert foreground to the dark surface to preserve contrast.
Touch/coarse-pointer controls grow to 44px without enlarging icons.
Focus-visible rings are explicit; selection uses tonal surfaces, never an accent
edge. The dialog itself owns overflow, preserving one scroll surface per region.
The page background is scroll-locked while the modal is open. Consumers should
use one active Modal per screen and close through its controlled callback rather
than an independently closing `form method="dialog"`.

IBM Plex Sans/Mono and Source Serif 4 normal/italic are self-hosted beneath
`styles/fonts`, with retained OFL licenses and download provenance. Latin glyphs
are bundled; other scripts use the documented system fallbacks. No CDN is needed.

The React dev tooling suggested by the frontend skill is not installed here:
package changes belong exclusively to foundation and this lane was explicitly
instructed not to mutate the dependency graph.

## Verification

Run from the repository root:

```sh
bun docs/evidence/p0-visual/capture-primitives.mjs
```

The isolated production bundle imports the actual exports and styles; it is not
a static copy or a product route. Existing foundation dependencies were used;
this lane did not change package files, lockfiles, routes, or configuration.

Result: exit 0, `PRIMITIVES_VERIFIED`. Twelve retained PNGs in
`docs/evidence/p0-visual/`: `primitives-{1440,390}-{light,dark}.png`,
`dialog-{1440,390}-{light,dark}.png`, and `end-{1440,390}-{light,dark}.png`.
Desktop is 1440x900 at DPR 1; phone is true iPhone-14 emulation, 390x844 at DPR 3.
Full-page phone captures are 1170px wide in physical pixels, not a 1170px layout.
The gallery includes all eleven exports; dialogs, focus state, error, disabled,
busy, empty, notification, and scrolled-end states are visible in the evidence.

`primitives-results.json` records the final four cases:

- No page horizontal overflow and no dialog overflow; all dialogs fit the viewport.
- Every active phone button/input is at least 44px high.
- All four font faces loaded from the bundled local assets.
- Solid action text contrast is at least 5.36:1 in light and 7.90:1 in dark.
- Dialog receives focus, wraps Tab/Shift+Tab, closes with Escape, restores trigger
  focus with a 2px focus-visible ring, and locks background scroll.
- Tabs support arrows, Home, End, disabled-item skipping; input error is labeled.

The assertions live in `tests/ui-product/primitives/browser-checks.mjs` and run
against real browser keyboard input, without fixed sleeps. The final command
passed all four width/theme cases in one run.

Targeted strict TypeScript compilation and oxlint both exited 0. LSP reported
zero diagnostics across the three TSX component files. The frontend draft guard
reported eight checked source/style files clean. The preview's native Bun build
completed successfully. No full-application build or Lighthouse score is claimed:
this lane owns infrastructure, not an application route or foundation wiring.

Visual QA: final light/dark gallery and modal captures were inspected for clipped
text, hierarchy, background/surface separation, focus, wrapping, and scrolled-end
content. Light geometry/palette follows the decoded contract; mobile/dark are
documented extrapolations. There is no before set because these primitives did
not exist before this change, and no pixel-diff claim between a component gallery
and a whole product screen. Independent nested reviewers were not launched, as
the assignment explicitly prohibits nested agents.

Initial failures, resolved: the eval-only Bun bundler could not resolve the
workspace React dependencies, so verification moved to native Bun 1.3.14.
Long-lived eval page targets also disappeared between calls, so the retained run
owns its complete browser lifetime inside one script. Native dialog Tab navigation
briefly moved focus outside the dialog; explicit first/last wrapping fixed it and
the final real-keyboard regression now passes. `role="dialog"` is explicit for
consistent browser-tool discovery.

Cleanup: the final report confirms browser closed, server stopped, and owned
temporary root `/tmp/quire-primitives-0kvYEc` removed. The exploratory browser,
server and `/tmp/quire-primitives-YX1oiz` were also removed. Only source, font
assets/licenses, tests, documentation and retained evidence remain. No commit or
push was performed.

Integration note: foundation's `.gitignore` currently ignores `docs/evidence/`.
The lead must explicitly retain this lane's `docs/evidence/p0-visual/**` files
with `git add -f` when preparing the authorized commit. This lane did not change
the shared ignore configuration or stage files.

Consumer obligations: supply data loading/error/offline decisions, theme
persistence, toast lifetime, and enabled tab values. The primitives intentionally
do not invent product state. Native title tooltips are pointer hints; accessible
names remain available on keyboard/touch. These are not rich tooltip widgets.
