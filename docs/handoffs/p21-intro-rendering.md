# Sign-in intro image evidence: FINAL

October 28, 2026. The apparent missing dark intro text is **not present in the
raw screenshot pixels**. No product CSS change was needed.

The diagnostic native-browser selection passed 1 case/30 computed-style
assertions, 49.62 seconds, exit 0, with scoped strict types and typed lint:
`mon_M1P7NRE25XWFRT8D`, `bash_355`. It captured fresh dark, light, and changed
dark at 1440 and touch-mobile 390, both full-page and element images, under
`docs/evidence/p21-intro-rendering/e8eaa60b-3bf0-4b3f-a73c-97ee46290204/`.
Styles remained white, fully opaque and visible with nonzero bounds.
Those assertions alone were not treated as pixel evidence.

Parent decoded the actual PNG bytes with Pillow. The 390x562 fresh-dark
and changed-dark element images are pixel-identical: ImageChops difference
bounding box is None. Both contain 5,809 bright pixels; light contains 5,125.
A single contact sheet of all three states displays the complete name,
heading, equation, feature list and footer. Repeated inline image presentations
had appeared to omit unchanged content; the original image bytes do not.

The original suspect mobile dark PNGs were separately decoded and cropped to
the 390x562 intro region. Each is pixel-identical to the intact fresh-dark
element image:

- `p21-domain-discovery/641ed467-672c-4824-ae09-c7566a7e5cf1/ready-390-dark.png`
- `p21-ldap-back/520fa66d-943f-4a3b-962e-714190c29c6c/directory-390-dark.png`
- `p21-ldap-sign-in/credentials-390-dark.png`

This supersedes the apparent intro-omission finding in the earlier LDAP and
domain handoffs. It does not claim universal browser or assistive-technology
acceptance. The diagnostic fixture closed its actual resources; parent
independently confirmed `/tmp/quire-ui-integrations-dIOMT5` absent and both
ports 40219/39791 refused connections.
