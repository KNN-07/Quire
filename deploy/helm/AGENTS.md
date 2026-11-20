# HELM DEPLOYMENT

## OVERVIEW
Operator-configured Kubernetes chart for API, repository and optional compiler worker roles; score 8, distinct cluster deployment domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Operator inputs | `values.yaml` | Images, secrets, storage and opt-ins |
| Chart metadata | `Chart.yaml` | Chart identity |
| Role workloads | `templates/roles.yaml` | API and repository resources |
| Runtime configuration | `templates/config.yaml` | ConfigMap and migration job |
| Ingress | `templates/ingress.yaml` | Optional public routing |
| Worker | `templates/worker.yaml` | Optional compiler worker |
| Release notes | `../portable/README.md` | Runtime prerequisites |
| Role contract | `../runtime/` | Images and process entrypoints |
| SSH service | `../ssh/README.md` | Separate restricted Git role |
| Compiler isolation | `../compiler/` | Fixed toolchain wrappers |
| Backup authority | `../installation/README.md` | Host recovery constraints |

## CONVENTIONS
- Reference operator-provisioned images, secrets and durable backup storage.
- Preserve repository singleton ownership while scaling API replicas.
- Keep ingress and compiler workers opt-in.

## ANTI-PATTERNS
- Do not treat chart defaults or appVersion as installed-cluster readiness.
- Never put credentials in chart values rendered as ordinary configuration.
- Do not infer HA or backup acceptance from template rendering.
- Do not scale the repository StatefulSet as if it were stateless API capacity.
- Do not enable workers without a verified remote environment and image.
- Keep operator-controlled secrets in existing Secret resources.
- Do not assume ingress and worker resources are installed by default.
