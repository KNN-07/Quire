# RESTRICTED GIT SSH

## OVERVIEW
Dedicated SSH broker runtime for restricted Git repository commands; score 8, distinct network entry-point domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Runtime composition | `runtime.ts` | Minimal identity, core and Git modules |
| Command grammar | `protocol.ts` | Allowed Git command and repository ID |
| SSH configuration | `config.ts` | Restricted sshd settings |
| Broker server | `server.ts` | Client and Git process lifecycle |
| Local deployment guide | `../../../deploy/ssh/README.md` | Role layout and provisioning boundary |
| SSH runbook | `../../../docs/runbooks/ssh.md` | Verification and operator procedures |
| Process launch | `process.ts` | Owned SSH subprocess lifecycle |
| Broker boundary | `client.ts` | Authenticated local Git request |
| Git command handling | `../../core/git/` | Repository actions and recovery |
| Account session rules | `../../accounts/identity/` | Authentication authority |

## CONVENTIONS
- Parse Git's single quoted repository argument into a validated project identifier.
- The SSH process owns Git recovery and uses the shared application database.
- Keep broker communication on authenticated loopback.

## ANTI-PATTERNS
- Never permit shell syntax, arbitrary paths or commands.
- Do not enable password login, TTY, forwarding, user rc or authorized_keys files.
- Keep this service separate from the machine's ordinary sshd.
- Do not register unrelated application adapters in the SSH runtime.
- Do not accept broker URLs outside the validated loopback boundary.
- Keep SSH host-key provisioning within the dedicated service role.
- Do not pass client command text to a shell.
