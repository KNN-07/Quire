# P74 conversion implementation notes

Scope: installation fixed execution recipes and interchange. Shared adapters,
publisher contracts and account UI belong to another child.

Image: `sha256:93b748053b3129df98ad47625f6e341b439ad393399ed50ca40e02ed3fc04bac`.

The existing Pandoc image has an entrypoint; conversion recipes must override it
with controller-owned command text. Installed configuration comes from the signed
profile, and staging uses the committed binding's work directory.

The existing supervisor fixture requires an absent historical TeX image. Add a
focused configurable fixture path; never build an unrelated TeX image.

Implementation now uses fixed Docker recipes, exact runner/broker output limits,
signed profile selection without derived-image inheritance, and tracked
probe/conversion shutdown.

Real HTTP conversion passed against an authenticated controller role. Scoped
interchange/source regressions: 38 pass, 0 fail. Final affected direct conversion,
recipe and isolated coordination checks: 8 pass, 0 fail.

Fixture diagnoses: Docker build needs an owned writable client cache and a local
base tag rather than a bare image ID. Renaming Pandoc changes the first version
line to `pandoc-real`; the fixture wrapper restores the expected program name.
The Docker event observer now aborts its owned HTTP stream after seeing starts
instead of awaiting cancellation of the open-ended stream. An unsigned-image
denial uses a different digest from the deliberately signed missing-image grant.

The expanded HTTP test now passes, including absent-image execution denial.
The cancellation fixture additionally subscribes to the broker's authenticated
payload-start acknowledgement before requesting stop; Docker's start event alone
precedes that acknowledgement. Early-close coordination remains covered by the
isolated lifecycle scenarios. Output-limit aborts are intentionally recorded by
the existing controller as canceled, not interrupted, so the assertion checks
that actual contract plus retained byte ceilings.

The remaining real probe failure was a production helper budget issue, confirmed
in the execution unit's journal: `docker wait` failed in Go's runtime with
`pthread_create failed: Resource temporarily unavailable`. The 32-task profile
also bounds the host helper, where Bun and two Docker CLI processes coexist.
Conversion runner Docker clients now use fixed `GOMAXPROCS=1`; signed limits
remain unchanged. Temporary runner diagnostic logging was removed.

Both installed test files now schema-parse `QUIRE_PANDOC_IMAGE` with an explicit
prerequisite error. The task-specific digest remains only in run documentation.

Final real installed run: 3 pass, 0 fail, 95 assertions, 114.67 seconds, exit 0.
Both real cancellation cases and both conversion output ceilings passed after
the helper thread fix. Final scoped types, deny-warning lint and bundles passed.
Cleanup audited 75 inactive owned units, 33 absent containers and 10 absent
supervisor roots. Temporary/cache/build directories are removed; logs and actual
downloaded ZIPs remain for parent review. Supplied Pandoc image is retained.
