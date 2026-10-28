# Same-origin HMR and complete SSH admission

The shared Node/Vite fixture now binds its HMR socket to the owned HTTP listener.
It no longer injects a client that attempts an unowned default port while the
server socket is disabled. The Chromium regression subscribes before navigation
to Vite's connected event, checks both direct and proxied authenticated application
WebSockets, and asserts no browser console errors or page errors.

The entire SSH Git session now owns mutation admission, including authorization,
public/quarantine repository creation, the protocol callback, fenced publication,
and temporary repository cleanup. The added real-session regression uses event
barriers, verifies reentrant maintenance is rejected inside the callback, and
verifies external maintenance sees the temporary repository already removed.

Receipt `bash_133`: six tests passed, zero failed. The five SSH cases include
actual clone/fetch/push, revocation after repository CAS, and recovery after
failed SQL finalization. Touched-file type-aware lint completed with exit code 0.
The subsequent file LSP request timed out waiting for fresh diagnostics; it is
not reported as a clean diagnostic result. Product-wide verification is pending.
