# P34 onboarding import boundary

October 28, 2026. Parent scope decision, not acceptance.

Persisted blank/template onboarding may proceed within the identity/account
lane. A real resumable import continuation remains required; the existing
`/projects?new=import` link alone does not close D14.

The onboarding lane has conditional permission for narrow optional
onboarding continuation hooks in `ProjectsPage.tsx` and `NewProjectDialog.tsx`.
It must preserve P27 environment-admission behavior and P33 account avatars.
The dialog is temporarily reserved while the existing installed-admission
browser run settles. Parent requested its release; no edit is authorized in
that file until release is communicated.

The implementation must persist an import attempt before dispatch, retain or
recover its actual operation identity, and avoid creating a second import
after a lost response or reload. Saving only a returned operation ID is not
proof of response-loss safety. Before an upload has reached the server,
reselecting a local file may be an explicit boundary; after a server operation
starts, progress must resume that operation rather than invent completion.

No signing/admission authority, project writer, or import authorization
weakening is permitted. The lane must report exact required hook/recovery
contracts before crossing any other shared scope. FINAL waits for actual
operation-to-editor proof and cleanup, not just the blank/template subset.

## Dialog release

Parent subsequently read `installed-pristine-targets.xml`: the held admission
invocation had already failed at October 28, 2026, 10:35:15Z, after 31 assertions
and 220.69 seconds. Its exact installation/web roots
`/tmp/quire-installation-integration-4EmHyB` and `/tmp/quire-p27-web-Q43nS6`
are absent, and ports 45501/33301 refuse connections. The delayed "active run"
messages therefore no longer justify holding the dialog.

The parent explicitly released `NewProjectDialog.tsx` to the onboarding lane
for the narrow hooks above. The lane must preserve admission behavior and
report when its edits settle. Parent is taking over the failed admission
follow-up and will not start a replacement browser run against changing dialog
source. P36's separate operation-result consumer correction is already FINAL.
