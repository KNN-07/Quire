# P62 deployment page and actual repository downloads

October 28, 2026. FINAL correction of P60 N14. This is native page/download
acceptance, not a new production deployment or published-release claim.

The self-hosting page now uses Bun 1.4.4, describes the implemented scale
profile, and shows the repository's native installer, Compose, Helm and signed
offline tooling. Commands and prerequisites are grounded in the actual
deployment/installation runbooks and shipped definitions. Operator image,
secret, namespace, storage and signing inputs remain explicit.

The page no longer calls Compose/Helm artifacts pending or claims signed
offline packaging is absent. It distinguishes the supported
`systemd-local-v1` signed-update driver from Compose/Helm, which reject that
driver. It invents no public chart repository, image tag, release bundle URL
or configured cluster. Native installation uses a new prefix and does not
overwrite data or automatically enable a daemon.

Five actual source files are linked as Vite assets with download names:
deployment and installation runbooks, Compose definition, Helm chart metadata
and Helm values. Native browser clicks downloaded each file and SHA-256
comparison matched the corresponding repository bytes. These are guides and
definitions, not a generated deployment containing operator credentials.
The inspected source downloads contain no embedded private-key blocks.

## Native and source evidence

`docs/evidence/p62-deployment-page/before.log` records the successful original
page capture. Desktop-dark and mobile-light overviews were opened before
the edit.

`after.log` records targeted type-aware deny-warning lint followed by the real
application capture/download script, `P62_AFTER_EXIT=0`, UTC 20:06:55Z through
20:07:49Z. Monitor `mon_79CAVDTQJH0ZM9V9` / `bash_463`.

The final packet is
`docs/evidence/p62-deployment-page/after-128c65df-bc5b-4fec-b861-26f8cdbff1a3/`.
All 12 Native/Compose/Helm states at 1440/390 in light/dark recorded no page
errors and no horizontal page overflow. Parent inspected all 12 install
panels, all eight download/offline section captures, and desktop/mobile
full-page overviews. The dark install panel is intentionally shared between
light and dark page themes. Commands wrap within the existing layout;
controls and links remain visible without overlap.

The five recorded downloads match these hashes:

| File | SHA-256 |
| --- | --- |
| `deployment.md` | `22004d2345830a66d865b698b235204977f822ded75df00d1adca4df136e239f` |
| `installation.md` | `ba8b2c066abfbb157a8898446b952c2a888a328971286deae1b2e9a224cbfbce` |
| `compose.yaml` | `a1d65a8e40edd8289390ccb2a86f200706c4859ec7633212e8ce764edfa746f2` |
| `Chart.yaml` | `1500b0b874595f5a7db894ed10c30c8f320224778d9153baf5291b485c2c1348` |
| `values.yaml` | `0ad6767bbcfe4402e23a71283a72fa13401cb74b8f4953f4c30dd5dd1984bf90` |

The source and five download inputs were hashed before capture and compared
again by the parent afterward; all six match. This later comparison is not
misrepresented as a contemporaneous post-run manifest.
The self-hosting source had clean LSP diagnostics. The frontend draft guard
also passed, `P62_DRAFT_EXIT=0`, under
`mon_MKJJJJMYJ1FKRBAR` / `bash_471`.

The capture script checks real navigation/layout/download behavior and shipped
file equality; no test pins the prose. Existing installed/Compose/Helm/offline
execution receipts are reused rather than rerun for a page-copy change.
The next production build must include the new asset imports and their guide
inputs; the current P61 changes are still being integrated.

## Cleanup

Parent independently verified both native fixture roots absent:
`/tmp/quire-ui-integrations-BaeTjY` and
`/tmp/quire-ui-integrations-v9Wqg4`.
Their web/API ports 41999, 46185, 35537 and 46289 refuse connections.
Browsers/application closures were awaited. Captures and downloaded copies
remain in evidence. No service was installed, no live cluster was changed,
and the unrelated port 5173 listener was untouched.
