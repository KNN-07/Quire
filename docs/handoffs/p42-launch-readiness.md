# P42 local launch readiness

October 28, 2026. FINAL scoped prerequisites check; literal-origin acceptance pending.

Parent checked the current required URL. `http://localhost:5173` returns HTTP
200 with title `FastShort`. The unrelated service was not stopped or modified.
`apps/web/vite.config.ts` explicitly uses port 5173 with `strictPort: true`;
the documented development launcher will not silently select another port.

The actual `bun run doctor` command ran in an isolated owned local runtime,
not against the existing `.data` directory. Raw receipt:
`docs/evidence/p42-launch-readiness/doctor.log`, explicit
`P42_DOCTOR_EXIT=0`, monitor `mon_35KXQ4DHC8FHY5JD` / `bash_412`, exit 0.
Required native runtime, sandbox and all ten required tools report ready:
Git, latexmk, pdfLaTeX, LaTeX, XeLaTeX, LuaLaTeX, BibTeX, Biber, SyncTeX,
and Bubblewrap. API port readiness is reported separately.

The isolated database had zero installed compiler-profile observations.
Doctor readiness is not a claim that an already-provisioned application
environment or the literal-origin browser workflow has been accepted.
Real profile probes still run at application startup.

After retaining the report, parent removed only
`/tmp/quire-p42-doctor.d0JN5a`, the exact directory created for this check.
`mon_5DGDYZK2F422PB6Z` / `bash_413` confirmed
`P42_DOCTOR_ROOT_REMOVED=1` and exit 0. No existing user data, service, image
or compiler installation was changed. The remaining port decision still
requires the user's current-session authorization.
