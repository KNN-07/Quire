# P72 project search - parent acceptance after audit corrections

October 29, 2026. The parent accepts the bounded native project-search
implementation. The independent audit's two concrete defects are fixed:
excerpts now begin at the actual match column, including matches on long
lines, and the protected-credential guard checks returned paths as well as
text before retaining or disclosing a hit.

Both new audit regressions failed against the prior implementation.
The complete corrected AI suite then passed **119 tests, 0 failures**,
including those regressions and the previously failing citation cases.
The citation fixes preserve execution consent: unsuccessful runs can expose
their terminal error/usage status without trying to reopen nonexistent
retrieval output; successful citation output still rechecks current consent.
Missing consent before dispatch reports failed/refunded, while revocation
during a running request remains canceled.

Evidence is retained in `docs/evidence/p73-core-checkpoint/validation.log`
and `search-audit-red.log`. Current root types, deny-warning lint and
production build pass. The separate acceptance type target initially omitted
the root's `vite/client` types; adding those existing types passes its recheck.
No source error was suppressed and no failing AI assertion was removed.

The native Assistant browser workflow and four inspected light/dark,
desktop/mobile consent captures remain accepted from
`p72-project-search-backend.md`. No UI behavior changed in these audit fixes.
The original independent FAIL report remains historical evidence, superseded
only for its two named findings. No additional review round was launched.

The capability stays opt-in, Chat/TeXGPT-only, server-mediated and bounded.
Discovered text cannot grant proposal edit authority. Live model compatibility,
binary/linked-file reading, commercial hosted-tier parity, physical-device
and human accessibility acceptance are not claimed.
