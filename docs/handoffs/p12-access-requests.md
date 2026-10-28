# Access-request eligibility and owner notices

October 28, 2026. FINAL for the scoped request-policy, notice and Share correction.

The original C32a requirement in `docs/discovery/services.md` permits Viewer
requests for Reviewer/Editor and Reviewer requests for Editor. The old route
also accepted Owner/Editor requests and Reviewer-to-Reviewer requests, and
produced no owner notification or email.

The route now checks current membership while holding the existing accounts
transaction lock, rejecting non-upgrades. Acceptance rechecks that condition
so an old request cannot downgrade a member promoted after submission.
The existing tested outsider-to-Editor request contract is preserved; requests
still grant no authority before owner acceptance.

Creation queues `project.access.requested` through the existing preference-aware
notification/mail helper in the same transaction. Its recipient is the current
project owner and its dedupe key binds the actual request ID. Notification
resource IDs identify the project. Mail uses a constant subject and a plain-text
requester/project/message body with a project link. No external mail is sent
inside the transaction or claimed delivered.

`tests/core/base/access-requests.test.ts` reproduced six failures against the
old code (three allowed transitions passed). After correction, the expanded
file and existing `catalog.test.ts` passed **14 cases, 45 assertions, 7.78s**,
exit 0 under `mon_Q3YGAFM687CKSXM5`. The same command's scoped strict TypeScript
and type-aware deny-warning lint passed. The native HTTP checks cover exact
role eligibility, unchanged authority before acceptance, replay dedupe, owner
opt-out, obsolete-request rejection and atomic rollback on real mail enqueue
failure. The expected SQLite trigger error remains visible in the receipt.

The existing fixtures await server/runtime teardown and remove their unique
roots. This is not a separate exact-root audit or live SMTP proof.

The before packet is
`docs/evidence/p12-access-requests/c71aa1f6-b7c2-4f78-bb6f-445948c17e4f/`
(12 desktop/mobile light/dark images). Direct inspection shows a Reviewer
offered Reviewer again and the owner list without a numeric pending count.
Its first test failed with an empty option array because exact label matching
did not match the existing implicit label; it is not a clean behavioral red
receipt for the options themselves. The actual screenshots and existing
source establish the UI mismatch. The selector was corrected to the named
combobox before the affected run.

The existing Share form now offers Reviewer only Editor, removes the upgrade
form for Editor while retaining the benefits summary, and displays the real
pending-request count in the owner's access-request heading. Existing
components, section styling and primary actions are reused; no new layout,
styling dependency or notification center was added. Priorities are current
role, permitted upgrade and message; the primary action is Send request.

The changed-surface run covers all three affected roles at 1440/390 and both
themes, a submitted default Reviewer-to-Editor request, and the existing real
Viewer request/owner approval case. `mon_6H36Y5BEX2F3TB65` completed exit 0:
**2 cases, 30 assertions, 59.61s**, followed by scoped strict TypeScript,
type-aware deny-warning lint and the changed-component draft guard, all exit 0.
The unrelated full sharing case was filtered, not counted as newly passed.

All 12 final images under
`docs/evidence/p12-access-requests/2329bd30-0aff-4ca1-a352-750f2e593a41/`
were opened and inspected. The 390 contexts use mobile/touch emulation at
DPR 3. Reviewer has only Editor, Editor retains current benefits without a
request form, and Owner has the real count with Accept/Decline controls.
No horizontal overflow or obscured changed controls was observed. This is the
real Share component with native services, not a new whole-editor route or
universal accessibility certification.

Durable UI reports are `docs/evidence/p12-access-requests/before.xml` and
`after.xml`. Both recorded fixture roots were independently absent:
`/tmp/quire-ui-editor-rJIrHN` and `/tmp/quire-ui-editor-Nf7jep`.
Their four exact ports 39159/36717/35443/34161 all returned `ECONNREFUSED`.
The existing approval test uses its own awaited fixture disposal; its root was
not separately logged by that unchanged test.

End-of-proof source fingerprints:

```text
8b4405fac70a40f52ed617ffd0ecbb6ce4933c3dc6cbfd365948702fe0f70129  services/core/base/access-routes.ts
36eda978a946720d3357b68606399949b5d6a6d64fb37af9978c05261ebfc4b8  apps/web/src/features/editor/review/share.tsx
fe5250a4a1e41a00a73b55c3ceab039c2a3f3c63ceb21c85c8b291fdc2cade40  apps/web/src/features/editor/review/share-access.tsx
0e13872a43634e0e2ef76fe4d911d58f30f61a5d4fcae06d504b2989ca61e797  tests/core/base/access-requests.test.ts
921f6bdc65a1f2e1d610fc2abd1d5855b3851435bf357fd7c5a3b23aaba97c4c  tests/ui-editor/review/access-request-ui.test.ts
```

Owner email is queued locally, not live-delivery acceptance. The count belongs
to the existing owner Share panel; no global notification-center badge is
claimed. Broader invitation, session-race and full application-route acceptance
retain their separate evidence and boundaries.
