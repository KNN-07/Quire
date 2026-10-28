# Benefit final-session corrections

Status: parent focused checks pass; independent recheck requested.

The independent verifier found two new deterministic failures after the original
backend acceptance: revoke the owner's actual session immediately after mutation
verification and writable selection still committed; expire the operator's
session at the same boundary and a benefit grant still committed. These are
separate from the earlier stale 12-failure coordination note.

The selection route now retains the authenticated principal and checks its
current, unexpired session and active account inside `quire:accounts` before
authorizing and changing membership selection. Grant admission now joins the
actual operator session and checks expiry, operator status and active account
inside its transaction before applying the existing freshness check.

Receipt `bash_202`, Bun 1.4.4: 18 tests passed, zero failed. This includes the two
unchanged independent attacks, four permanent revoked/expired-session regressions
and the existing positive capacity/grant cases. Current fields remain unchanged
on denial (401 for selection, 403 for grants). Scoped type-aware lint passed.
Root TypeScript failed only on three concurrently edited prepared-runtime test
lines; their owner received the exact diagnostics. No suppression was added.

`docs/evidence/p4-benefits-session-fences/source.sha256` records the two corrected
production files and two new permanent regression files. The original backend
manifest remains historical evidence and is not overwritten or relabeled.
The independent verifier has the corrected input for a focused two-case recheck.
This is native final-session evidence, not an unexecuted PostgreSQL attack claim
or a security audit of every application mutation.
