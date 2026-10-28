# Core capability corrections

The source inventory audit identified three concrete behavioral gaps.

- **P11:** project rename now requires Owner authority both before work and
  inside the account/branch-fenced transaction. Editors retain settings-only
  changes. The tools UI owner was notified to omit unchanged name fields from
  Editor settings submissions; that affected browser check remains pending.
- **C32b:** Editor and Reviewer members both consume collaborator capacity.
  Capacity checks exclude the current target's existing seat during role
  changes. Invitation admission/acceptance, access requests and Editor-link
  admission use the same check, including transactional authority rechecks.
- **C37/C38:** labeled history stays accessible beyond the ordinary
  `historyDays` window. The central history DTO/access gate applies to timeline,
  source download, comparison and restore, while current project authorization
  remains required. Unlabeled expired history stays physically retained but
  inaccessible under the current policy.

`bash_161` reproduced all three defects before their changes. `bash_162` passed
25 related access/authority cases; the two history failures exposed a parent
mistake referencing a nonexistent policy property. That mistake was removed.
`bash_163` then passed all four affected history tests, touched-file type-aware
lint and full repository TypeScript, exit 0. Taken together, all 27 related
cases have passing evidence on their final relevant input.

Actual tests cover owner rename versus Editor settings, a rejected third
Reviewer seat and same-seat Reviewer-to-Editor change, and labeled history
timeline/download/compare/restore after a controlled clock advance.
Broader owner-entitlement recomputation from the audit remains a separate gap.
