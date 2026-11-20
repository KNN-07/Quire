# Current-file browser offline editing

The source document stays editable for ten minutes (600000 milliseconds) after a
short transport disconnection. This is one deployment policy, not a vendor
Free/Premium entitlement mapping.

Operators can set the public Vite build variable `VITE_QUIRE_OFFLINE_WINDOW_MS`.
For example, for a native asset build from the repository root:

```sh
VITE_QUIRE_OFFLINE_WINDOW_MS=120000 ./node_modules/.bin/bun run build
```

For development, set the same variable when starting `bun run dev:web`.
For a native deployment, rebuild and serve the new web assets.

For Compose or Helm, the supplied runtime Dockerfile builds its own web assets.
A host rebuild does not change that image. Set the public value in the image's
web build stage when Vite runs, build a new application image, and roll it out.
The supplied Dockerfile does not expose this setting as a build argument.
Changing only the server or pod environment after building does not affect
existing assets; open tabs need to load the new client.

Keep private env files outside the release trees copied into
[offline bundles](deployment.md#signed-offline-package-and-image-bundles).
The packager does not remove them, and the Vite setting is public.

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
