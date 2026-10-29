# P72 authorized project search: parent implementation evidence

October 29, 2026. Native backend, browser and integrated checks pass;
independent review remains pending. The backend producer returned a source
freeze, not a completed verified implementation. The parent inspected the
changes, added the missing regression tests, implemented the consumer, and
retained failed browser-fixture attempts rather than calling the DAG complete.

## Contract

`aiRunCreate.projectSearch` is an optional boolean, off when omitted. Only
Chat and TeXGPT accept it. The Assistant exposes a separate explicit checkbox
with disclosure that readable excerpts from other files in the same branch
may reach the configured provider. Changing tool or remounting the composer
clears that local choice. No saved account preference silently enables it.

The existing OpenAI-compatible chat-completions route advertises only
`project_search`, with a query-only argument. The invoking run supplies
actor/session/project/branch authority; the model cannot override it.
At most three searches execute, with ten hits and 4,096 UTF-16 code units
per excerpt. Surrogate pairs are preserved, and the existing 256-KiB
aggregate-context limit applies. The provider receives structured tool
results with actual file IDs, paths, ranges and text. Tool-choice violations,
unknown/malformed functions, duplicate IDs and excessive calls fail closed.

Quire mediates search through existing project text search and document reads.
Session, project policy, confidentiality, provider/operator versions and
run state are rechecked before queries and outbound calls. Discovered branch
revision, file version/path and excerpt text are checked again before later
disclosure and final publication. Binary and linked sources retain the
existing search exclusions. There is no model filesystem/network access.
Search results are read-only context: proposal validation still permits edits
only to the original explicitly selected files and ranges.

The existing context manifest records actual consulted files and a digest,
not raw search queries/excerpts. Ask/private retention and reviewed Agent
publication remain in force. Multiple model calls consume one dispatched
run allowance; cancellation and reserved-use refund semantics are unchanged.
Configured models must support function tools; no fake search fallback is
provided when the provider refuses or cannot execute the protocol.

## Evidence

`docs/evidence/p72-project-search-backend/workflow.log`: 11 pass, 0 fail,
53 assertions. `boundaries.log`: 9 pass, 0 fail, 57 assertions. These cover
actual model-requested retrieval from native storage, project isolation,
default-off behavior, forbidden argument authority, unsupported tools,
malformed/excess/duplicate calls, aggregate size, Unicode excerpt/count
bounds, protected credentials, read-only discovered files, session/config/
confidentiality changes, cancellation and changed-source publication.

`tests/ui-editor/project-search/workflow.test.ts` passed 1 test with
23 assertions after two fixture corrections. The original fixture
unconditionally toggled an already open Assistant closed; it then failed to
renew unsent message/consent after the existing responsive sidebar-to-drawer
remount. The corrected fixture observes the actual toggle state and supplies
fresh consent after remount. No product assertion was weakened.

Passing browser evidence:
`docs/evidence/p72-project-search-ui/d63155d6-d6b6-44ec-a1d6-bff9659cedb2`.
The parent opened all four 1440/390 light/dark consent screenshots. The new
checkbox/disclosure is readable within the existing Assistant scroll owner;
the native Send workflow succeeds, source remains unchanged, unsupported
tool selection removes the checkbox, and reload leaves consent off.
This is bounded Chromium viewport evidence, not physical-mobile or whole
Assistant accessibility acceptance.

Final scoped backend/UI/Source types, root types, mapping and production build
passed with 1,711 unchanged source/configuration inputs; 16 affected legacy AI
tests also passed. `integrated-validation.log` and its before/after manifests
retain that execution. Two test-only lint findings (unused import and redundant
unknown union) were corrected without runtime changes; `corrected-lint.log`
retains the passing scoped types and root deny-warning lint recheck. The
existing Vite bundle-size warning remains. No full-suite AI green
claim is made: the earlier unrelated two consent-guard failures remain.

## Cleanup and limits

The passing fixture reports `/tmp/quire-assembly-mTOdgo` absent and no
page errors. One failed fixture exited during an unhandled response wait
and left a web listener/root. The parent identified PID 1627351 by its exact
`/tmp/quire-assembly-8fsqDT` command and port 43371, sent TERM, observed its
shutdown, then removed only that owned root. The fixture now joins click
and response promises so a failed action cannot leave an unhandled wait.

No live provider, commercial eligibility, arbitrary readable binary/linked
content, direct provider filesystem access, port 5173 takeover, commit or
push is claimed. Search is an explicit Quire capability under existing AI
policy, not a copied vendor paid-tier entitlement.
