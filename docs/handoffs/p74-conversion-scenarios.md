# P74 installed conversion scenarios

Registered before implementation, November 13, 2026.

- Happy: an authenticated installed API role imports Markdown over real HTTP,
  exports DOCX, Markdown and HTML, downloads actual ZIP output, and imports the
  generated DOCX. Original bytes remain preserved; source has no export artifacts.
- Authority denied: strict recipes reject argv, filters, output paths, image
  overrides, invalid formats and traversal. Wrong roles, native backends,
  unsigned profiles/images and ambiguous grants cannot execute conversion.
- Limits: probe stdout 16 KiB, conversion stdout 64 MiB, stderr 64 KiB;
  application upload bounds also apply. Signed resource limits bound requests.
- Lifecycle: pre-aborted operations create no execution; coordinated close during
  a probe and cancellation during conversion settle before cleanup. Closing
  denies subsequent probes/conversions. Controller-owned containers and cgroups
  are absent after execution, cancellation and fixture disposal.
- Regression: source sealing/digest rejection, direct Docker conversion, existing
  interchange HTTP behavior, and existing parent-loss/restart ownership coverage.
  No unrelated compiler image will be provisioned.

Owned run root: `/tmp/quire-p74-conversion-st_01a1d599`; caches and logs stay below
that root. The supplied Pandoc image is retained for parent integration QA.
