# Editor review panels

This feature follows the shared Quire tokens and primitives in
`apps/web/src/styles/` and `apps/web/src/ui/`. The decoded D04, D10 and D20
sources in `docs/discovery/design-source/` are the visual and content contract.

## 1. Purpose

Give collaborators one truthful surface for access control, anchored discussion,
tracked proposals, project chat, and immutable history operations. Server policy
and optimistic versions remain authoritative.

## 2. Visual direction

Dense, quiet operational UI: white and subtle neutral surfaces, one-pixel
dividers, compact controls, IBM Plex Sans/Mono, and semantic success, warning,
deletion and author washes from the global token set. No decorative metrics,
badges, gradients, or animation.

## 3. Interaction principles

- Mutations show a pending state and retain the previous response until the
  server returns.
- Errors appear beside the object or form that failed.
- Empty states state what is absent and the next permitted action.
- Viewer, reviewer, editor and owner controls derive from effective
  capabilities; a hidden control never substitutes for server enforcement.
- Source anchors are Yjs relative positions and resolve against the live shared
  document. Epoch or quote divergence is shown as a conflict.

## 4. Spacing and layout

Layout: Share dialog - place access management over the editor without changing document order -> imposter (https://github.com/changeroa/StyleGallery/blob/main/patterns/overlay-exception/imposter.md); scroll owner: `.quire-review__body`; anti-patterns: no visual reordering, no page scroll behind the modal, no fixed desktop width on mobile.

Layout: Review panel - keep source-linked work dominant with a bounded review utility pane -> panel-layout (https://github.com/changeroa/StyleGallery/blob/main/patterns/viewport-shell/panel-layout.md); scroll owner: `.quire-review__body`; anti-patterns: no competing document scrollbar, no fixed 816px mobile height, no utility pane before the primary task in DOM order.

Layout: History panel - explore a version list beside selected comparison detail -> list-detail (https://github.com/changeroa/StyleGallery/blob/main/patterns/split-sidebar/list-detail.md); scroll owner: `.quire-history__timeline`; anti-patterns: no horizontal primary-content scroll, no visually reordered focus sequence, no unbounded code column.

At 390px, each panel is one readable column. At 1440px the review/history
utility regions may sit beside their detail region. Every scrollable flex/grid
child has `min-block-size: 0`.

## 5. Components and states

### `ReviewPanel`

Routes the frozen `view` prop to one panel and owns no application shell.
Loading, error, empty, offline and recovery states remain visible in place.

### `SharePanel`

Primary action: Invite.

Information priorities:
1. Current people and roles.
2. Pending invitations and access requests.
3. Revocable link access, ownership transfer and Git sharing.

Left out on purpose: collaborator quotas not returned by the API, decorative
plan copy, reviewer links, fabricated token URLs, and invented organization
policy details.

Required content: email invite, Editor/Reviewer/Viewer role choice, Invite,
member role change/removal, pending invite resend/revoke, access request
accept/decline, Off/Viewer/Editor link choice, one-time link copy, revoke,
transfer ownership, Git sharing link, Done.

States: loading, owner management, non-owner request form, invitation error,
member mutation error, link unavailable/revoked, one-time URL ready.

### `ThreadsPanel`

Primary action: Comment.

Information priorities:
1. Open anchored threads and pending tracked edits.
2. Selected source quote and author conversation.
3. Resolved threads and moderation actions.

Left out on purpose: assistant actions, plan marketing, decorative author
stripes, raw IDs, and client-only proposal persistence.

Required content: file/open/resolved filters, anchored comment, reply, edit own
comment, delete own comment, resolve/reopen, delete resolved thread, selected
and all proposal accept/reject, conflict state, replacement proposal form,
source navigation.

States: loading, empty, offline-disabled creation, recovery-disabled creation,
read-only viewer, proposal conflict, mutation error.

### `ChatPanel`

Primary action: Send message.

Information priorities:
1. Chronological messages.
2. Author and local time.
3. Composer availability reason.

Left out on purpose: assistant chat, read receipts, typing indicators, invented
mention results, and anonymous identities.

Required content: messages, named-author label when known, composer, Send,
policy-disabled reason, anonymous-disabled reason.

States: loading, empty, disabled by policy/access, sending, error.

### `HistoryPanel`

Primary action: Restore selected version.

Information priorities:
1. Selected immutable version, labels, authors and accessibility.
2. Changed files and exact before/after source.
3. Timeline, source download and restore choices.

Left out on purpose: fabricated summaries, semantic diff confidence, commit-only
history language, and restoration of permanent comment tombstones.

Required content: all/labels-only timeline, label add/remove, authors, changed
files, file comparison, copy comparison, source ZIP download, full restore,
file-only restore, deleted-file recovery, inaccessible-history state.

States: loading, empty, inaccessible, no difference, restore confirmation,
download/copy feedback, mutation error.

## 6. Accessibility

Every form control has a visible label. Icon-only controls use the shared
labelled primitive. Focus follows DOM/reading order. Dialogs use the shared
native modal focus trap and Escape behavior. Status changes use polite live
regions; errors use alert semantics. Touch targets reach 44 CSS pixels on
coarse pointers and narrow screens.

## 7. Persisted proposal contract

Tracked proposals load through `endpoints.suggestionsList`, scoped by branch,
current file or project overview, and edit status. The complete suggestion DTO
is retained when one edit matches a filter. `review.changed` refreshes proposal
metadata; `tree.changed` refreshes both branch authority and proposals before a
decision. No browser-only proposal store is authoritative.
