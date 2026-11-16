# Publisher destination adapter

The `publisher` contribution consumes the existing `submission` interchange
export. Preparation creates the real source/generated ZIP and a durable local
preparation receipt. It performs no destination request. Submission requires a
separate explicit `submit` action with `confirmation: true`.

## Operator configuration

Configure `/api/admin/providers/publisher` with:

- `baseUrl`: the destination's authorized API root.
- `secret`: the OAuth client secret, encrypted by the shared adapter runtime.
- `publisherContract`: the typed destination contract mapping below.
- `model`: legacy JSON encoding of the same contract, still accepted for existing
  configurations. Supply only one mapping field when changing the mapping.
- `policy`: the ordinary Quire provider policy payload.

Paths are relative to `baseUrl`; absolute paths, traversal, query strings, and
fragments are rejected.

Direct destination:

```json
{
  "version": 1,
  "mode": "direct",
  "credentialTestPath": "api/me",
  "oauth": {
    "authorizationPath": "oauth/authorize",
    "tokenPath": "oauth/token",
    "revokePath": "oauth/revoke",
    "clientId": "quire-client",
    "scopes": ["submissions:read", "submissions:write"],
    "tokenAuthentication": "body"
  },
  "submitPath": "api/submissions",
  "statusPath": "api/submissions/{submissionId}",
  "responseFields": {
    "submissionId": "submission_id",
    "status": "status",
    "receipt": "receipt"
  }
}
```

The direct submit endpoint receives the prepared ZIP as `application/zip`,
with bearer authorization, `Idempotency-Key`, `X-Quire-Project-Id`, and
`X-Quire-Archive-Sha256`. The configured response fields must contain non-empty
strings. Status uses authenticated `GET` against `statusPath`.

Manual destination:

```json
{
  "version": 1,
  "mode": "manual",
  "credentialTestPath": "api/me",
  "oauth": {
    "authorizationPath": "oauth/authorize",
    "tokenPath": "oauth/token",
    "revokePath": "oauth/revoke",
    "clientId": "quire-client",
    "scopes": ["submissions:read"],
    "tokenAuthentication": "body"
  }
}
```

Bearer destinations replace the `oauth` object with `"authentication": "bearer"`.
They need no operator OAuth client secret. An authenticated user enrolls their
destination-issued token with `POST /api/connections/publisher/credentials`,
body `{ "label": "Journal account", "accessToken": "..." }` and normal mutation
headers. Quire verifies the token at the configured `credentialTestPath` before
creating an encrypted ready grant. OAuth start explicitly rejects bearer mode.
Bearer disconnect forgets the saved credential locally and does not claim
upstream revocation. The grant retains this removal mode even if the operator
later changes enrollment configuration.

An optional `actions` object can disable individual actions:
`{ "prepare": true, "submit": false, "status": true }`. Unspecified actions stay
enabled. Capability responses and dispatch/publication enforce those settings.
Manual status remains a local durable-state read by default.

Manual `prepare` returns the downloadable archive operation and advertises
`manual: true, direct: false`. Manual `submit` performs no network request and
requires both `manualSubmissionId` and the provider-issued `manualReceipt`.
Without those values the durable state remains `prepared`.

## External prerequisite

There is no universal publisher API. An operator must supply a destination-
specific public or partner API contract, OAuth registration or bearer enrollment, authorized user
grant, exact path/field mapping, and recipient approval. Quire does not infer
private endpoints and never records `submitted` without a provider receipt.

Typed configuration is stored separately from model JSON. Omitted mapping fields
retain the existing publisher mapping; supplying a new typed mapping replaces
legacy model JSON and supplying legacy model JSON replaces the typed mapping.
Migration does not rewrite existing configurations or increment their versions.
The account connection UI supports both enrollment modes. A dedicated publisher
administration form and project preparation/submission screen remain separate work.
