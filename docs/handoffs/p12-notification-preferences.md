# Notification settings defaults and governed notices: FINAL

October 28, 2026. Parent-owned account consumer correction.

The server's notification helper treats unspecified event preferences as
enabled. The account form previously displayed those same events unchecked,
so saving an otherwise unchanged form silently wrote false opt-outs.
`notifications.tsx` now uses the server's enabled default while preserving
explicit false values, unknown saved event keys, channels and project overrides.

The existing list also exposes named controls for `project.access.requested`
and `organization.ai.changed`. Their independently verified producers remain
unchanged. The form keeps the existing account checkbox layout and Save changes
action; no new styling, dependency or notification-center behavior was added.

The new native application browser regression first failed on the original
unchecked mention setting. After the correction it passed **1 case,
17 assertions, 51.86 seconds**, exit 0 under `mon_T9Z0C0Q10WT13XG8`.
The same command's scoped strict TypeScript, type-aware deny-warning lint and
changed-component draft guard all passed. The test uses the real
`/settings/notifications` route and HTTP preference storage, not intercepted
successful responses. It proves unchanged saves retain enabled defaults,
explicit existing false values and custom/project keys, then verifies both
new opt-outs persist across reload.

Durable reports:
`docs/evidence/p12-notification-preferences/before.xml` and `after.xml`.
All four current 1440/390 light/dark screenshots were opened and inspected
under `docs/evidence/p12-notification-preferences/3279bfec-6a36-487b-84eb-0d06dd156dc5/`.
Mobile uses touch/mobile emulation at DPR 3. Changed labels and controls are
readable without horizontal overflow. The original before images remain in
the sibling `be6ee694-37a3-4c2c-aa5b-1691d78e4870/` packet.

Both exact roots were independently absent after awaited disposal:
`/tmp/quire-ui-integrations-Zb0oFL` and `/tmp/quire-ui-integrations-jqHqNi`.
Ports 37977/37299/46591/36919 all returned `ECONNREFUSED`.
No live email delivery, general notification-center badge or new
cross-browser accessibility certification is claimed.
