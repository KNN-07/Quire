# Current-file browser offline editing

The source document stays editable for ten minutes (600000 milliseconds) after a
short transport disconnection. This is one deployment policy, not a vendor
Free/Premium entitlement mapping.

Operators can set the public Vite build variable `VITE_QUIRE_OFFLINE_WINDOW_MS`.
For example, from the repository root:

```sh
VITE_QUIRE_OFFLINE_WINDOW_MS=120000 ./node_modules/.bin/bun run build
```

For development, set the same variable when starting `bun run dev:web`. Vite also
reads it from the web root's `.env.local` (`apps/web/.env.local`). Rebuild and serve
the new web assets to change an installed deployment. Changing only the server
environment after building does not change existing assets or open tabs.

Unset means exactly 600000 ms. A configured value must contain decimal digits and
represent a positive integer no greater than 2147483647 ms (the browser timer
maximum). Empty, fractional, negative, nonnumeric, zero, and overflowing values
are rejected when the document transport is constructed; invalid configuration
does not silently select the default.

The budget starts at the first disconnect and is not extended by reconnect
attempts that never synchronize. At expiry, the current source locks, retaining
its text and pending updates in the original tab. A successful synchronized
reconnect sends retained updates through the existing acknowledgement queue.
Current backend role and document-epoch fences still apply; an epoch conflict or
lost editing access enters recovery instead of silently rebasing or discarding
local text. Keep the original tab open and use its retained-source recovery UI
to copy/export or explicitly resolve conflicting source.

This window covers only the current source file. It adds no offline file
switching, compilation, comments, AI, or arbitrary project mutations. It is not
durable browser storage, a reload/reopen guarantee, or a longer offline desktop
workflow. For longer disconnected work, download or Git-sync sources and use a
separate local editor/compiler.
