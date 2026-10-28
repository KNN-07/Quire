# Confined remote PDF validation

Docker-profile PDF validation now runs on the trusted external compiler worker,
not inside the API container. The worker renders every PDF artifact through
`pdftoppm` in the selected immutable Docker image using the existing bounded,
network-isolated, read-only sandbox. Only successful rendering produces a receipt.
Temporary validator sources and containers follow the sandbox cleanup lifecycle.

The receipt is HMAC-SHA256 under the authenticated worker bearer. Its domain is
`quire:pdf-validation:pdftoppm:v1`; it binds job ID, attempt, fencing token,
environment ID, immutable image digest, artifact path and content SHA-256.
The API checks it with constant-time comparison after current lease/capability
authorization and digest validation. Artifact publication rechecks the lease
inside its transaction. Missing or invalid Docker receipts are rejected with
`PDF_VALIDATION_REQUIRED`; native-profile uploads retain actual native confined
rendering.

This trusts the authenticated worker process, as the existing compile protocol
already does. The receipt is not hardware attestation and does not establish
trust in a compromised worker host. The compiler sandbox never receives the
worker bearer or job capability. No API Docker socket, Docker CLI, privileged
container or native TeX installation is required for Docker-profile validation.

Receipt `bash_144`: five tests passed with exit 0, followed by touched-file
type-aware lint and complete repository TypeScript with exit 0. Coverage includes
every signed identity field, malformed PDF rejection by actual confined Docker
pdftoppm, genuine native external worker execution, protocol fencing and a real
Docker worker publishing an authenticated PDF before draining to zero.

Additional actual HTTP missing/forged receipt assertions passed in `bash_146`,
followed by touched-test type-aware lint, exit 0. Both were rejected with
`PDF_VALIDATION_REQUIRED`, then the actual worker's rendered and signed PDF was
accepted and downloaded before the worker drained to zero. The prior `bash_145`
probe failed before reaching validation because its fixture labeled binary bytes
as JSON; the fixture now labels only JSON string bodies that way. No production
validation assertion was weakened.

Actual hardened deployment acceptance subsequently passed:
`docs/evidence/p2o-deployment/deployed-pdf-proof-branch.log`, exit 0.
The API had no Docker/native runner access. For actual compiled PDF bytes,
missing and forged receipts were both rejected before the authentic worker
upload was accepted. Authorized download returned 41,497 bytes, SHA-256
`ed71277fae5986392ec628709e8c33a3dc6244b4cf41f18871d2bbaef094ecbc`.
Job `f424d722-79f1-4474-b181-78ca61f13dce` ran on the immutable image named
in that receipt. Broader deployment cleanup and final handoff remain
deployment-owned.
