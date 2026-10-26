# Quire visual implementation specification

Reference inspection: October 26, 2026. Source: `Quire — LaTeX Editor.html`.

## 1. Evidence and source of truth

The input is a design board containing **23 separately bundled HTML screens**, not one editor screenshot. It unpacks gzip/base64 manifests, swaps in a document template, and renders its screens in iframes. The board's beige background, 48px outer padding, labels, and vertical spacing are presentation chrome, **not application UI**.

All 23 screens were decoded, rendered in an **omowright-owned Chromium headless-shell**, captured at their original 1440px-wide board dimensions, and visually inspected. Files:

- `docs/evidence/design/00-original-overview.png`: original board loaded directly, 1536 × 1000 viewport. This fits the first 1440px iframe at x48/y78 without clipping its right edge.
- `docs/evidence/design/01-editor.png` through `23-reset-password.png`: individual screens, using the exact extracted nested bundles. These remove only the outer presentation board.
- `docs/evidence/design/capture.mjs`: executable capture invocation and browser/profile cleanup.
- `docs/evidence/design/measurements.json`: rendered text, controls, semantic snapshots, panel rectangles where collected, and font-loading evidence.
- `docs/discovery/design-source/NN-name.html`: intact nested bundle, directly renderable with JavaScript.
- `docs/discovery/design-source/NN-name.source.html`: decoded authored template with exact inline styles, SVGs, copy, conditional branches, and `Component extends DCLogic` state code.

The `.source.html` files are **reading/porting source**, not standalone pages: their script `src` UUIDs are resolved by the enclosing bundle. Use the corresponding `.html` file to render.

Precedence: exact decoded styles and content > inspected screenshots > descriptions below. No visual redesign was performed. Source quirks, colored selected outlines, decorative plan labels, and static illustrative values are preserved as reference evidence rather than silently “fixed.”

### Capture environment and invocation

```sh
cd /home/norman/Repos/Quire
bun docs/evidence/design/capture.mjs
```

Engine: `/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`, launched through `omowright.connectPipe`, with `--headless`, `--no-sandbox`, and a unique temporary user-data directory. Device scale factor is 1; individual viewports are 1440 × the authored iframe height, with `fullPage: true`. Full-page output can be taller than the authored viewport when the source overflows (notably billing, authentication administration, and long marketing pages).

The original was opened from `file:///home/norman/Repos/Quire/Quire%20%E2%80%94%20LaTeX%20Editor.html`. Its iframe blob texts were read from `window.__resourceBlobs`, and each nested `__bundler/template` JSON island was decoded without changing the inputs. The first capture pass completed screens 01–17 before its cell budget expired; screens 18–23 completed using `goto(..., {waitUntil: "commit"})`. Every retained individual capture has visible rendered screen content, not a loading placeholder. The original overview was recaptured after awaiting the first iframe's visible Recompile button; its viewport was pinned after navigation and measured as 1536 × 1000.

The full Chrome binary produced disappearing page targets in this environment; the owned headless-shell path above worked. Google Fonts are external rather than bundled. Font evidence for the editor includes loaded IBM Plex Sans, IBM Plex Mono, and Source Serif 4 subsets; “unloaded” entries in the font set also include unused language subsets, not necessarily a missing family.

## 2. Product hierarchy and visual direction

This is a collaborative LaTeX editor for research teams, with real-git review and an explicit-review AI assistant. The operational UI is dense, quiet, and predominantly white. It uses narrow toolbars, lightly tinted sidebars, neutral 1px dividers, and ordinary bordered controls. It is not a collection of oversized dashboard cards.

Primary action on the editor: **Recompile**. Reading priorities: (1) paper source/PDF workspace, (2) project files and document structure, (3) assistant and compilation status. Retain the visible sample project name **Latent Dynamics Note**, paper **Latent Dynamics for Sample-Efficient Control**, authors **Kien Nguyen** and **Mai Tran**, and undefined citation **ha2018world** when matching the reference.

Other shells have different primary actions: projects → New project; settings → Save changes; AI review → Accept all; sign-in → organization SSO; new-project dialog → Create from template in its default state. Reproduce action emphasis from the relevant screen rather than applying one global button color to every action.

Left out on purpose: no additional product navigation, stock photography, gradients, invented charts, animations, or decorative dashboard metrics. Existing metrics on admin/billing screens belong to the supplied designs.

## 3. Exact shared visual tokens

These names are proposed implementation aliases; the reference itself uses inline literals.

| Role | Exact value |
| --- | --- |
| App/background | `#F4F5F7` |
| Main surface / paper / primary-button text | `#FFFFFF` |
| Sidebar and toolbar surface | `#FAFAFB` |
| Subtle inset/code surface | `#F6F7F9` |
| Segmented-control track / neutral wash | `#EEF0F3` |
| PDF workspace | `#E6E8EC` |
| Main ink / dark header / dark button | `#16181D` |
| Paper ink | `#111111` |
| Body secondary ink | `#4A505E` |
| Tertiary heading/help ink | `#5B6170` |
| Muted line numbers | `#8A909C` |
| Dividers / card borders | `#E3E5EA` |
| Control borders | `#D5D8DF` |
| Brand action/link | `#2F4FD6` |
| Link hover | `#1F3AA8` |
| Selected file/tool/nav wash | `#E8EDFF` |
| Active source-line wash | `#EEF2FF` |
| AI action / sparkle | `#6B4FA0` |
| AI wash / AI boundary | `#FAF8FD` / `#DDD3F0` |
| Success ink / stronger success ink | `#157A4A` / `#12613A` |
| Addition row / addition ink | `#E6F4EA` / `#135C33` |
| Deletion row / deletion ink | `#FDECEC` / `#8F1D16` |
| Error ink | `#B42318` |
| Warning ink / light warning wash | `#A15C00` / `#FFF8EE` |
| Warning boundary | `#F1D7B3` |
| Search match | `#FFE58F` |
| Avatar KN wash / ink | `#DCE4FF` / `#24399E` |
| Avatar MT wash / ink | `#FCE3CF` / `#8A4B08` |
| Syntax command `.k` | `#3446B8` |
| Syntax group/string `.g` | `#8A4B08` |
| Syntax option `.o` | `#6B4FA0` |
| Syntax math `.m` | `#0E6E66` |
| Syntax comment `.c` | `#6B7280`, italic |

No dark application theme is supplied. Dark authentication/marketing panels and admin headers are intentional regions within the light reference, not evidence of a complete dark token set.

### Type

- **IBM Plex Sans**, system-ui, sans-serif: all application chrome. Weight 400 body, 500 labels/secondary actions, 600 headings/primary actions.
- **IBM Plex Mono**, monospace: source, filenames in technical contexts, hashes, branches, URLs, code snippets. Code editor: **13px / 22px**.
- **Source Serif 4**, Georgia, serif: paper preview, visual editor, marketing display headings, italic lowercase `q` mark.
- Operational shell base 13px; settings/admin/auth base 14px; marketing base 16px.
- Section eyebrows: 11px, weight 600, uppercase, `letter-spacing: .06em`.
- Settings page title 24px/600; admin page title 22px/600; dialog titles 18px/600.
- Landing hero 64px; pricing hero 56px; self-hosting hero 58px, Source Serif 4. Sign-in statement 44px; onboarding statement 40px.
- Paper preview: 12.5px / 1.5, title 20px / 1.3 weight 400, section headings 15px/600, abstract 11.5px, author/date 13px.

### Geometry and control styling

Common radii: 6px compact controls/rows, 8px regular controls, 10px compact cards, 12px settings cards, 14px dialogs/auth card. Primary toolbar controls are 34px high; segmented options 30px inside a 3px-padded track, 2px option gaps, 8px track radius and 6px option radius. Selected segment: white, dark text, `0 1px 2px rgba(22,24,29,.12)`.

Form controls are generally 38–42px high, 1px `#D5D8DF` border, 8px radius, 10–12px horizontal padding. Authentication CTA height 46px. Ordinary buttons use white/neutral border; brand buttons use blue/white; AI buttons use purple/white; accepting a particular edit uses green/white. Destructive actions use error-colored ink.

Spacing is mostly 4/6/8/10/12/14/16/20/24/28/32/40/48/56/64px. Do not replace the dense 13px editor with the more spacious marketing scale.

## 4. Editor layout and reusable components

Layout: full-width vertical shell, top project toolbar → wrapping horizontal workspace with tool rail, files, source/PDF main region, optional assistant → bottom status strip. The source uses flex-basis and fixed panel heights, not a CSS-grid percentage split or a draggable splitter implementation.

At a 1440 × 900 viewport the first measurement had a 1425px layout width because a 15px browser scrollbar was present. Measured panel bounds:

| Region | x | y | width | height |
| --- | ---: | ---: | ---: | ---: |
| Header | 0 | 0 | 1425 | 56 |
| Tool rail | 0 | 56 | 52 | 816 |
| Files | 52 | 56 | 236.14 | 816 |
| Main source/PDF | 288.14 | 56 | 816.72 | 816 |
| Source | 288.14 | 56 | 408.86 | 816 |
| PDF | 697 | 56 | 407.86 | 816 |
| Assistant | 1104.86 | 56 | 320.14 | 816 |
| Footer | 0 | 872 | 1425 | 29 |

The final screenshot can show slightly different widths after layout settles; use authored flex rules rather than freezing these measured decimals.

### Header

56px minimum height, white, bottom divider; flex-wrap, 12px gap, 8px 16px padding. Brand mark: 28 × 28px dark rounded square, radius 7px; white italic serif `q`, 18px. Wordmark 15px/600. Breadcrumb follows at 13px. A flexible spacer precedes view mode switch (Source/Split/Visual/PDF), blue split Recompile button (main action plus dropdown), monospace branch `main ↑2`, overlapping 30px avatars, Assistant toggle with purple sparkle, Share button.

### Tools and files

52px fixed-basis rail, white/right border, 10px vertical padding, 4px gaps. Actions are 40 × 40px with 8px radius; active Files has blue wash. Icons in order: file, search, Git with count 3, comments with count 3, history clock, serif Sigma, assistant sparkle; project sliders at bottom.

Files aside: `flex: 1 0 236px; max-width: 280px; height: 816px; overflow: auto`. Files heading and 28px new-file/new-folder/upload controls. Tree rows 28–30px tall, 6px radius for selected `main.tex`, 6px list inset, 8px row inset, nested indentation 30px. Preserve `main.tex`, sections (`intro.tex`, `method.tex`, `results.tex`), figures (`arch.pdf`, `curves.png`), `refs.bib`, `quire.yml`. Modified M is amber, added A green. Outline is separated by a neutral divider: Introduction; Method → Latent model, Planning; Experiments; References.

### Source / visual / PDF region

Main: `flex: 999 1 680px; min-width: 0; display:flex; flex-wrap:wrap`. Each visible editor/preview: `flex: 1 1 340px; min-width:0; height:816px`.

Source tabs: 38px row; `main.tex` active, `method.tex`, `refs.bib`, compiler `pdfLaTeX` trailing. Reference active file has an inset 2px top accent. Source is **styled HTML lines, not an actual editor widget**. Line number gutter 52px with 16px right padding. Scrollable code area, 10px vertical inset, preformatted whitespace, 13px/22px mono. Selection line 24 has blue wash; citation has wavy warning underline; collaborator cursor label is amber. Warning status box anchors below the scrollable code with 12px outer margin, 10px 12px padding, warning icon, `main.tex:24`, explanation, Fix with AI and Add BibTeX entry.

Visual mode replaces code with a formatting toolbar: Normal text/Section/Subsection, bold, italic, Sigma, Figure, Table, `\ref`, `\cite`. Body uses serif 16px/1.6 and 32px 40px padding. Preserve abstract inset, labeled section, inline math chips, dashed equation container, reference/citation chips, and included-file row.

PDF toolbar: 38px minimum, wrapping; code/PDF SyncTeX jumps, Page 1 / 6, minus, 100%, plus, download. Gray scrollable canvas with 24px padding. White simulated paper: width 100%, maximum 560px, minimum height 740px, padding 64px 56px. Shadow `0 1px 3px rgba(22,24,29,.12), 0 8px 24px rgba(22,24,29,.08)`. The paper is also HTML, **not an embedded compiled PDF**. Preserve title, authors, fixed date October 26, 2026, abstract, equation (1), highlighted unresolved figure/citation, and figure placeholder.

### Assistant and footer

Assistant: `flex:1 0 320px; max-width:380px; height:816px`, white/left divider. Header has sparkle, Assistant title, Open agent link, close. Chat asks why `ha2018world` is undefined; answer explains absent bibliography entry, shows a monospace BibTeX block, Add to refs.bib/Copy, and a publication-verification note. Bottom suggestions: Rewrite selection, Explain compile log, Make a table. Composer: file/line context chip, textarea, read-only/approval explanation, purple send arrow.

Footer: 28px minimum, 12px type, 16px gaps and horizontal padding, white/top divider. Left: green compile dot, Compiled in 1.8 s, pdfLaTeX · TeX Live 2026, 1 warning · logs. Right: Ln 24, Col 41; UTF-8; All changes saved; main · 2 ahead.

### Icons and assets

The reference uses **hand-authored inline SVG**, predominantly 20 × 20 viewBox with 14/16/20px display sizes, no fill, currentColor stroke around 1.6px, and occasional 2px strokes. Reuse paths from decoded source for exact fidelity; do not assume a Lucide/Heroicons dependency. Sparkle has a four-point large star plus small lower-right star. Git icon has three circular nodes. Search is a circle plus diagonal line. Download uses downward arrow and baseline. Warning is a filled triangle with white exclamation. Sigma, ×, arrows, plus/minus, and initials are text in several controls. Decorative SVGs have `aria-hidden`; meaningful icon buttons have accessible labels.

There are no bundled photographic assets or font binaries in the page manifests. Template thumbnails, landing editor mockups, equations, and architecture are HTML/SVG/CSS constructs. Three compressed JavaScript assets recur across screens; Share and New project have an additional imported HTML asset for the underlying screen.

## 5. Screen contracts and captured dimensions

Each row's stem names both `docs/evidence/design/STEM.png` and `docs/discovery/design-source/STEM.source.html`. Dimensions are viewport dimensions, not a promise of no page overflow.

| Stem | Viewport | Required structure / content / emphasis |
| --- | --- | --- |
| `01-editor` | 1440×900 | Full editor described above; Split selected, assistant open. |
| `02-git` | 1440×900 | 56px project header; branch/changes/commit left sidebar (300px basis, 340px max), central unified line diff, right history/branches. Stage checkboxes; Stage all; commit message; compile-before-commit; Commit 2 files; Push ↑2; Pull & merge; clone URL/Copy/token link. Central Unified/Split/Rendered PDF and Discard hunk/Stage hunk. Added green/deleted red lines; five history entries and three branches. |
| `03-ai-agent` | 1440×900 | Left review area, right assistant conversation (~380px). Review header: 2 files · 2 pending, Reject all/Accept all. Two independent patch cards (`main.tex`, `refs.bib`), per-hunk Reject/Accept, explicit `[N]` missing result note, commit-accepted-changes checkbox. Ask/Agent switch, five-step completed run, citation source card, six suggestion chips, composer with file contexts, attach, edit permission select, send. |
| `04-history` | 1440×900 | Changed-files/authors left (220px basis/260px max); central author-colored source comparison; chronological Versions right. All history/Labels only; Label this version; Download .zip; blue Restore this version. Default selected label Submitted to workshop. Underline additions in author colors and strike removed text, with legend. |
| `05-billing` | 1440×1000 | Settings shell, current Standard yearly plan, $149.25/year and renewal Oct 12, 2027; compare/switch period; usage bars; upgrade; payment method; invoice-email/tax fields; invoices table; cancel subscription. Main settings wrapper max 1160px, 32px 24px 64px padding, 32px sidebar/content gap. |
| `06-editor-tools` | 1440×900 | 52px tools rail, 300px search/symbol sidebar, source area. Find/Replace, match case/whole word/regex, five results in three files. Selected match yellow; bibliography completion popup over source at citation prefix `ha`, two results, remote search link, keyboard hint. Symbols state has Greek/Operators/Relations/Arrows/Misc categories and insertion confirmation. |
| `07-projects` | 1440×1100 | 60px header with brand, 520px-max search, workspace chooser and avatar. Sidebar New project, ownership filters/counts, archived/trash, tags and workspace note. Main projects table (Title/Owner/Last edited/Git/Compiler); creation/import actions; template section with six category pills and eight CSS-drawn thumbnails/cards. Use table for projects, not replacement project cards. |
| `08-sign-in` | 1440×900 | Two wrapping 480px-basis columns. Left dark marketing panel with brand, 44px serif statement, equation, three feature lines, footer. Right centered 380px-max form: organization SSO primary, Google/GitHub/ORCID, email/password, Forgot?, dark Sign in, signup/legal links. SSO state requests organization/domain with a back action. |
| `09-pricing` | 1440×2600 | Marketing nav; centered serif headline; monthly/yearly switch; five plans (Free/Student/Standard/Pro/Organizations); lab quote and dark self-host strip; full comparison table with six feature groups; native disclosure FAQs; final CTA and footer. Annual default: Student $6.13/month, Standard $12.44, Pro $24.94; yearly totals $73.50/$149.25/$299.25. Reference prices are sample design content, not verified commercial terms. |
| `10-review` | 1440×900 | Large source left and review sidebar right (~340px); track changes toggle in header; file tabs with counts; colored author insertion/deletion and comment anchors. Sidebar This file/Overview, 3 open/1 resolved, bulk and per-change accept/reject, conversation thread/reply, Resolve, Ask assistant, new comment composer; bottom legends. |
| `11-compile-logs` | 1440×900 | Source left and log list right. Recompile + compile-mode select. Failure banner explicitly states PDF remains last successful build. All/Errors/Warnings/Typesetting counts 4/1/2/1; parsed/raw switch. Four diagnostic cards with cause, file:line, raw excerpt, Go to line, Fix with AI. Output files/download and cache actions below. |
| `12-admin-identity` | 1440×1100 | Dark 56px admin header, white navigation (220px basis/250px max), pale content background; Authentication title. Main max1040px. SAML/OIDC/LDAP switch; SP identifiers/copy/download; provider/attribute/domain fields; enforcement/account creation/break-glass checkboxes; Test connection and Save; SCIM endpoint/token/Regenerate; group-to-role/AI-access mapping table. Full content exceeds authored height. |
| `13-pdf-diff` | 1440×900 | Header diff-format switch; From/To revision selects and Side by side/Overlay switch; Download diff PDF. Gray canvas with two paper pages and red/green region highlights. Right changed-pages list 1,2,6; reflow-only explanation. |
| `14-onboarding` | 1440×900 | Dark intro/progress left, 420px-max account form right. Steps Create account → Verify email → Pick starting point. First form: social providers, SSO link, Full name/Email/Password, Create account, legal links. Later kinds Paper/Thesis/Slides/Coursework; template/import choices retained in source. |
| `15-landing` | 1440×3300 | Marketing navigation, centered 64px serif hero and primary Start writing — free, secondary Browse templates; large constructed editor mockup. Four view-mode cards; Git explanation/terminal; AI-review illustration; six general features; dark organization section; pricing; four FAQ disclosures; final CTA/footer. 1200px content maximum and wide horizontal section padding; full-page capture is taller than viewport. |
| `16-settings` | 1440×1000 | Shared settings sidebar, default Profile. Profile card includes 72px avatar, Upload photo/Remove, Full name, Name in LaTeX, managed Email, Affiliation, ORCID iD, Interface language; Cancel/Save changes. Other state panels: Sign-in & SSO, Editor, AI assistant, Git & integrations, Notifications. |
| `17-self-hosting` | 1440×3000 | Dark hero with download/install actions and Docker Compose/Helm code tabs; full-feature free server vs optional support plan; services and requirements; AI provider choices; cloud/server comparison; support inquiry form; footer. Preserve `[PRICE]`, `[N]`, and version placeholders as unresolved reference values, not invented product guarantees. |
| `18-admin-console` | 1440×900 | Dark Quire Server header, admin sidebar, overview title/health/Architecture link; update notice; six service health cards; compile queue table + Add worker; instance/authentication/backups cards; provider strip with policy toggles/Configure. |
| `19-architecture` | 1440×900 | White diagram: heading at x64/y64; dashed infrastructure boundary; Browser/git CLI → dark ingress → Web & API, real-time sync, Git server, AI gateway, workers; PostgreSQL/Redis/object storage right; external identity provider above and model endpoint left. Labeled arrows and border styles encode service/storage/external status. Copy paths and box geometry from source SVG rather than rebuilding by eye. |
| `20-share` | 1440×900 | Underlying editor without assistant, 48%-alpha dark scrim; centered dialog max620px, top72px, white/radius14, large shadow. Title/close; email invite/role/Invite; people list with owner, editor, reviewer, pending invite; role selects/Resend; Off/View/Edit link access; git sharing/transfer ownership links; dark Done. |
| `21-new-project` | 1440×900 | Projects background + same scrim; white max820px dialog at top64px, radius14. Five tabs: Blank, From template (default), Import from GitHub, Upload .zip, Clone git URL. Name/workspace controls always present; default six-template grid, Conference paper selected; selected-note footer, Cancel, blue Create from template. Keep compiler/TeX version/seed files, repository/sync, zip upload, URL/auth branches from source. |
| `22-admin-operations` | 1440×1000 | Same admin shell; default Users & groups, search/role filter, Export CSV/Invite users, four-row people table with Manage. Other tabs: Compile workers, TeX Live images, AI provider, Templates, Storage & backups, Updates, Support, Audit log; source includes each entire panel. |
| `23-reset-password` | 1440×900 | Centered 420px white card, 14px radius, 32px padding on pale background; brand above. Initial email and Send reset link, SSO explanation and navigation. Later inbox, new password+confirmation/strength indicator, success states; 46px CTAs. |

## 6. State and interaction contract

These behaviors are present in bundled local state code, not inferred backend implementations:

- Editor defaults to `split`, assistant open; modes expose source only / source+PDF / visual+PDF / PDF only. Assistant toggle closes/reopens; Fix with AI opens it.
- AI review tracks two independent `pending|accepted|rejected` hunks; pending count recomputes; Accept all/Reject all set both. Ask/Agent is local state.
- History defaults to `v3`, all entries; label-only filter and timeline selection update the selected metadata.
- Tools switches search/symbols, category, and last inserted-command message. Search/replace itself is illustrative.
- Projects filters the template list by All/Papers/Theses/Presentations/CVs/Robotics Lab. Main ownership links are not implemented data queries.
- Sign-in toggles method chooser/SSO. Pricing toggles annual/monthly: monthly Student $9.75, Standard $18.75, Pro $33.75.
- Review accepts/rejects two changes, resolves/reopens one thread, tracks the remaining open count, and toggles track-changes display.
- Logs filter four diagnostic records and toggle parsed/raw display.
- Admin identity toggles SAML/OIDC/LDAP; testing reveals a local tested state and resets when protocol changes.
- PDF diff toggles side-by-side/overlay.
- Signup advances a bounded three-step flow and changes chosen writing kind. Reset advances a bounded four-step flow with Back.
- Settings toggles six panels. Self-hosting toggles Compose/Helm instructions.
- Share defaults link access Off; view/edit reveal different help and tokenized example URLs.
- New project defaults template/conf; switching start mode changes fields, action label, and footer note; choosing template changes name placeholder/selection.
- Admin operations switches nine panels.

Many visible actions have no handler or only an example link: actual editing, compile, git operations, authentication, invitations, payments, downloads, persistence, and AI calls must be built separately. Relative `*.dc.html` navigation names are original design filenames, not an implemented router. Do not claim these integrations work because a button is rendered.

## 7. Responsive, accessibility, and fidelity boundaries

The source has wrapping flex containers, flexible min-width-zero centers, auto-fit form/template grids, max-width forms, and overflow-auto panels. It does **not** supply a polished mobile editor shell or explicit breakpoint system. Editor panels retain 816px fixed heights and may wrap into very tall pages on narrow screens. Authentication columns wrap rather than turn into a mobile drawer. Do not infer mobile pixel contracts from the 1440px boards; a mobile implementation needs an explicit layout decision.

Keyboard/accessibility features present: labeled navigation and regions; role groups/tablists/dialogs; aria-pressed/selected mode state; labeled icon controls; hidden field labels; descriptive compile-status text; visually distinct insertion/deletion markup. Preserve them when porting. The source is not proof of full accessibility compliance: several buttons are 26–40px high, modal focus trapping/Escape handling is not implemented, form submission/validation is mostly illustrative, and control hover/disabled/focus styles are incomplete. Add production behavior without altering the documented desktop reference hierarchy. No interaction animation system, offline state, global loading treatment, or complete error-state catalogue is supplied.

The template and screenshots are evidence of intended surfaces, not a finished design-system package. Avoid silently inventing dark mode, real-data semantics, missing support prices, or production service versions.

## 8. Reuse and implementation handoff

Recommended component boundaries: AppHeader, BrandMark, Breadcrumbs, SegmentedControl, ToolRail, ProjectTree, DocumentOutline, EditorTabs, SourcePane, VisualPane, PdfToolbar/PdfPaper, AssistantPanel/Composer, CompileStatusBar, DiffPane, Timeline, ReviewThread, DiagnosticCard, ProjectsTable, TemplateCard, SettingsShell/FormSection, AdminShell/DataTable, ModalShell, AuthSplitShell, MarketingNav/Section/Footer.

Port the inline styles to shared tokens and these components, but retain source/paper/assistant separation and the compact geometry. Use the decoded templates for every hidden field and alternative panel: they retain the full required copy and control inventory, including panels not shown in default screenshots. The recorded measurements supplement rather than replace this source.

Verification completed: original loaded; 23 nested templates decoded; 23 individual screenshots rendered and inspected; originals preserved; changes restricted to the assigned report/evidence/source paths. Capture script syntax parsed successfully with Bun.Transpiler. Language-server diagnostics could not initialize because the workspace has no TypeScript installation; no dependency was installed for this documentation task. No application code, commits, or product integration tests were added. No Lighthouse score or complete responsive/accessibility conformance is claimed for this reference extraction.
