# P2 foundation follow-ups

Parent evidence, October 27, 2026. These are verified prerequisites, not
acceptance of the editor, live federation or all external adapters.

## Installed runtime dependencies

Official npm metadata was checked before installation. `bun install` exited 0
and retained exact versions in `package.json` and `bun.lock`:

- `@node-saml/node-saml` 5.2.0, `@xmldom/xmldom` 0.9.12, `ldapts` 9.2.0;
  fixture dependency `xml-crypto` 6.4.0. Native Bun 1.3.14 imports all four
  successfully. Real signed IdP/LDAP/SCIM tests remain federation-owned.
- `nspell` 2.1.5 and `@types/nspell` 2.1.6; dictionaries `dictionary-en` 4.0.0,
  `dictionary-en-gb` 3.0.0, `dictionary-vi` 3.0.0. Native checks accepted real
  corpus words and a newly added custom word for each dictionary.
- `pyodide` 314.0.7. Its actual core distribution is generated at
  `/extensions/pyodide/`, with `version.json`. Browser execution/approval is
  verified separately by the tools producer, not by package installation.

`scripts/spelling-assets.ts` generates same-origin affix/dictionary files,
versions and retained upstream licenses under `/dictionaries/`. These are
en-US, en-GB and Vietnamese corpora. No `dictionary-zh` package was published
at the queried registry endpoint; Chinese spelling is explicitly unavailable
in the generated manifest rather than silently replaced with English.
Chinese interface localization remains an independent editor requirement.

Install, dev and build scripts provision these generated assets. Public asset
copies are ignored in Git and reproducible from the pinned lockfile.
No CDN is required to initialize the bundled core Python/spelling runtimes.
The Pyodide core is not a claim that every optional scientific wheel is bundled.

## Federation boundaries

Existing identity configuration/test/metadata and SCIM token routes are
operator-laned. New typed endpoints are `identityBreakGlass`,
`identityCertificates` and account-laned `ldapLogin`. Draft identity tests
retain optional LDAP user-bind credentials. The original configuration write
schema is preserved. `bash_127`: two schema tests plus touched type-aware lint
passed, exit 0.

The OpenID verifier preserves custom payload claims only after validating
the actual signature and standard claims. Federation explicitly requests
`strictIssuer: true`; the existing Google legacy issuer exception remains
available to the original Google adapter but is rejected in strict mode.
The real RSA/JWKS regression checks signed groups, tampered payload denial,
strict alias denial and exact issuer acceptance.

`PolicyPort.forProject` now intersects independent `federation-user` rows for
the actor. An actual SQL/runtime regression proves the ceiling constrains
policy without replacing ordinary user settings; removing it restores the
remaining user policy. No baseline migration was rewritten.

`bash_126`: both verifier/policy regressions and touched type-aware lint
passed, exit 0. These do not claim live third-party identity success.

## Adapter caller authority

The public `ExternalAdapter` port now requires actor identity for connection
tests and actor/parameters/optimistic version for actions. The new typed
`connectionAvailability` endpoint is implemented by the shared adapter owner.
Its final independent producer receipt is `p2x-base.md`: 54 native tests,
strict TypeScript and type-aware lint passed. Consumer business workflows and
the new shared migration's actual PostgreSQL execution remain integration work.
