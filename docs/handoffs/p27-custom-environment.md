# P27 custom environment admission

October 28, 2026. FINAL, completed through the parent P37 follow-up.

The authoritative current receipt is
`docs/handoffs/p37-admission-recovery.md`, backed by its separate original
terminal/JUnit artifacts and the final
`docs/evidence/p27-custom-environment/9196f4c1-6f29-496c-84ca-d6e317688163/` packet.

The implemented path separates toolchain probing from signed execution
admission, exposes the distinction in creation/settings/administration, and
requires an operator-reviewed next signed release to authorize the exact image,
environment and worker role. A separate operator proposal/packaging path
retains signing authority outside the application.

Actual installed build/probe -> signed sequence-2 admission -> replacement
worker -> real PDF -> signed sequence-3 revocation passed one test with 80
assertions. Parent inspected 24 affected captures and rendered the retained
PDF. Exact roots, listeners, 68 units, 58 containers and the derived image
were confirmed absent after cleanup.

Historical failed invocations remain retained. Fail-closed unbuilt/wrong-role
responses still use a generic internal-error mapping, and the original browser
cleanup failure has no proven root-cause diagnosis. Native/same-host scope and
operator configuration limits remain explicit in P37 and the installation
runbook. No literal-port-5173, global build, live vendor or arbitrary cluster
acceptance is inferred.
