# Identity provider row layout: FINAL

October 28, 2026. This corrects the phone layout finding retained in
`p18-management-ui.md`, without changing provider availability or identity
link/unlink behavior.

## Scope and layout

The existing account CSS and integration settings supply the visual conventions.
Provider name, availability reason and link action remain present. Names precede
reasons; actions stay alongside details on desktop and below full-width details
on phones. The document remains the scroll owner. No additional cards, badges,
provider claims or navigation are introduced.

The change is scoped through `account-identities`, including existing linked
identity rows. Reasons use the existing secondary color and spacing tokens.
Mobile buttons wrap long names and retain the existing touch-target token.

## Evidence

The new actual-application browser regression initially failed at the
`separateLines` geometry assertion: **0 passed, 1 failed, 2 assertions**,
41.99 seconds, exit 1 (`mon_XW9Q6DKA17ZJ139J`, `bash_338`).
Its original screenshot is retained at
`docs/evidence/p20-identity-layout/4750c335-a7b6-4529-aeaf-1fc7ffa8f814/1440-light.png`.
It was opened and confirms concatenated provider names and availability reasons.
The earlier P18 phone captures also retain the narrow-column finding.

The corrected browser run passed **1 case, 106 assertions**, 45.21 seconds,
exit 0 under `mon_7XSFBJF6BYD7RY07` (`bash_339`). Scoped strict TypeScript and
type-aware deny-warning lint passed in the same chained command before the
browser run. The test uses actual provider
availability responses, checks geometry rather than prose, and captures
1440/390 light/dark with touch/mobile context enabled at 390.
TypeScript LSP diagnostics found no errors in the component or test.
CSS LSP is unavailable because Biome is not installed; no dependency was added
solely for that optional editor integration.

All four final screenshots under
`docs/evidence/p20-identity-layout/5df691c3-4950-4a5e-ad06-982d35de4270/`
were opened and inspected. Provider names and reasons are visibly separated;
phone actions appear below readable full-width details. No overlap, blank
controls or horizontal overflow was observed in either theme.

The baseline and final fixtures closed their owned browsers, adapters, runtime
and web servers. Parent checks independently confirmed both exact roots
`/tmp/quire-ui-integrations-g3R6et` and
`/tmp/quire-ui-integrations-7T1WnY` absent, and all four listeners
39975/46689/44841/34403 refused connections.

This is scoped unconfigured-provider layout acceptance, not new live-provider,
linked-identity protocol, whole-product or Lighthouse acceptance. Existing
protocol receipts stand; no identity operation implementation changed.
