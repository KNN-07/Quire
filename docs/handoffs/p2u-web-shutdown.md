# Owned web proxy shutdown

The shared Node/Vite test listener now tracks every accepted socket, stops
accepting connections and destroys its owned sockets before awaiting Vite and
listener closure. This includes upgraded application WebSockets, not just normal
HTTP connections. No API scheduler, application admission or user source behavior
was changed.

The new real transport regression keeps the upstream API and downstream client
open while calling web shutdown. It first verifies a bidirectional proxied frame,
then requires both the listener shutdown and client-close event to complete.
`bash_159` reproduced the old five-second shutdown timeout. After the fix,
`bash_160` passed that regression and the existing authenticated direct/proxy
WebSocket plus HMR test, followed by touched-file type-aware lint, exit 0.

This fixes the account fixture's independent web-close deadlock. It does not
claim to fix or suppress the separately observed native descriptor failures.
