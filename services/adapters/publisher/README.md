# Publisher destination adapter

The `publisher` contribution consumes the existing `submission` interchange
export. Preparation creates the real source/generated ZIP and a durable local
preparation receipt. It performs no destination request. Submission requires a
separate explicit `submit` action with `confirmation: true`.

## Operator configuration

Configure `/api/admin/providers/publisher` with:

- `baseUrl`: the destination's authorized API root.
- `secret`: the OAuth client secret, encrypted by the shared adapter runtime.
- `model`: the exact destination contract mapping JSON below.
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

Manual `prepare` returns the downloadable archive operation and advertises
`manual: true, direct: false`. Manual `submit` performs no network request and
requires both `manualSubmissionId` and the provider-issued `manualReceipt`.
Without those values the durable state remains `prepared`.

## External prerequisite

There is no universal publisher API. An operator must supply a destination-
specific public or partner API contract, OAuth registration, authorized user
grant, exact path/field mapping, and recipient approval. Quire does not infer
private endpoints and never records `submitted` without a provider receipt.

The current shared provider DTO has no typed contract-mapping field, so this
adapter uses the existing `model` string as versioned JSON. It also exposes one
uniform capability state for all actions and supports OAuth enrollment only.
A future shared-contract delta should add typed per-action capabilities,
publisher contract configuration, and non-OAuth credential enrollment.
