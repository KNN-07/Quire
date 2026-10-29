# P66 pre-rendered asset reuse

FINAL, October 28, 2026. The existing Compile optimization disclosure now
gives a concrete pre-render/download/upload/reuse workflow using actual
compiler artifacts and persistent project files. The linked download is the
real bundled toolchain runbook. No quota increase or timing claim is made.

The supported recipe uses root `main.tex`, the provisioned restricted Docker
profile and its `quire-tikz` rule. Authors download the matching generated
`.pdf`, `.md5` and `.dpth` files, upload the complete set under its original
names, and select TikZ only-graphics mode. Guidance explicitly requires
regeneration when figure source or numbering changes; only-graphics mode
does not update stale figures. Arbitrary prefixes/diagrams are not promised.

## Real native workflow

`docs/evidence/p66-compile-optimization/native.log` records repository Bun
1.4.4, the actual command, UTC 22:44:46Z-22:45:48Z, four matching before/after
source/test/runbook/event-consumer hashes and:

```text
bun test tests/ui-product/compile-optimization/native.test.ts
1 pass
0 fail
17 expect() calls
P66_NATIVE_EXIT=0
```

The fixture reuses the previously executed restricted-profile report for
unchanged immutable image
`sha256:1ffb2fe8f831d4296f2de1c993a491444a9f6706e5498151ff41783468448258`.
It registers that fixture environment and creates source through the real
core service; project creation itself is not claimed as a new native-browser
scenario. Every optimization action afterward uses the assembled browser:

1. Recompile generates actual figure artifacts in job
   `83a1de96-7f4b-45b2-8526-75719adc88b4`.
2. Actual Output files buttons emit browser downloads for
   `output-figure0.pdf`, `output-figure0.md5`, and `output-figure0.dpth`.
3. File actions > Upload files persists those exact bytes into the project.
4. The real source editor saves only-graphics mode and deliberately replaces
   the external generation command with `false`.
5. Clear generated cache returns HTTP 200. Recompile creates successful job
   `773903b8-6cf8-451f-9c25-85cac0b52538`, proving reuse works without that
   generation command. Authenticated source downloads remain byte-equal for
   all three uploaded companions.
6. Extracted PDF text contains the actual figure label, and the built-in
   viewer renders the resulting PDF.

The packet
`docs/evidence/p66-compile-optimization/e3bc6a4b-c409-4ff9-95a6-e3e9bfd2ae4d/`
retains both job DTOs, source before/after, uploaded file records, downloaded
companions, four guidance captures and the rendered PDF screenshot.
The reused main PDF is recorded as 18,680 bytes, SHA-256
`de0c8e2867ecb39b6a553bcb607077a8603fb825a8488ad99a9595aa28e564c2`.
Its browser rendering is retained; the main PDF binary itself is not copied
outside the disposed fixture.

The figure PDF is retained: 12,662 bytes, SHA-256
`821dfa59924760786c62cafcb3930b4ca79a8ff91dd69556a7df510f52917f4e`.
Its one page was separately rendered and opened by the parent.
The matching MD5 companion is 62 bytes, blob
`f667bc10285b3ea08d2be5714b262b3694ae478f0005badb1124dcb184ad9a72`;
the depth companion is intentionally empty, blob
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
All three blob digests match their original generated artifacts.

## Visual, static and cleanup evidence

The parent opened all four guidance captures at 1440/390 in light/dark and
the actual rebuilt-PDF screenshot. Instructions wrap within the scrollable
Logs pane without horizontal overflow or overlapping principal controls.
Long guidance continues below the fold; no claim is made that it fits one
screen. The independent retained figure rendering shows its actual label
inside the expected border.

`static.log` records scoped TypeScript and type-aware deny-warning lint exit 0
(`P66_STATIC_EXIT=0`). Native browser errors are empty. The fixture closed its
browser and application and removed `/tmp/quire-ui-editor-1RxYhh`; the parent
independently confirmed absence. Web/API origins were ports 38643/41845.
The shared pre-existing image was reused, not deleted or rebuilt.

This closes the concrete C16 guidance and C27 companion-preservation gaps.
Earlier 2D/3D fixture evidence remains separately bounded; this native example
is one simple externalized figure, not universal diagram compatibility.
No unchanged generic cache or provisioning suite was replayed. Whole-product
integrated validation and literal port 5173 acceptance remain separate.
