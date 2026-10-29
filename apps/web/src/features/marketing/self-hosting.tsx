import { Tabs } from "../../ui";
import { SupportForm } from "./support";
import type { MarketingPageProps } from "./types";
import deploymentRunbook from "../../../../../docs/runbooks/deployment.md?url";
import installationRunbook from "../../../../../docs/runbooks/installation.md?url";
import composeDefinition from "../../../../../deploy/compose/compose.yaml?url";
import helmChart from "../../../../../deploy/helm/Chart.yaml?url";
import helmValues from "../../../../../deploy/helm/values.yaml?url";

export const nativeInstallCommands = `bun install --frozen-lockfile
BUN="$PWD/node_modules/.bin/bun"
"$BUN" run build
PREFIX="$HOME/quire-server"
"$BUN" scripts/ops/install.ts --source "$PWD" \\
  --prefix "$PREFIX" --bun "$BUN" --port 43181
"$PREFIX/bin/quire" serve`;

export function SelfHosting(props: MarketingPageProps) {
  return <>
    <section className="qm-dark"><div className="qm-wrap qm-section qm-server-hero qm-split">
      <div><span className="qm-eyebrow">Quire Server · free to self-host</span><h1>Host it yourself.<br />Keep control.</h1><p className="qm-lead">The editor, git, identity and optional AI integrations, on servers you control. No license key or commercial feature gates; capabilities still require their runtime dependencies.</p><div className="qm-actions"><a className="qm-link-button" href="#install">Install Quire Server</a><a href="#requirements">Read the requirements</a></div><small>Pinned Bun 1.4.4 · Native and scale profiles</small></div>
      <div id="install" className="qm-install"><Tabs label="Install method" defaultValue="native" items={[
        { value: "native", label: "Native", content: <><pre>{nativeInstallCommands}</pre><p>Start with Bun 1.4.4 and the supplied source checkout. Run from its root. The destination must not already exist; installation does not overwrite data or enable a system service.</p><p>Open the installed service on port 43181. In a second terminal, run <code>$HOME/quire-server/bin/quire doctor</code> to check the running installation and confined compiler.</p><a href="#deployment-guides">Read the complete installation requirements</a></> },
        { value: "compose", label: "Docker Compose", content: <div className="qm-install-note"><h3>Repository Compose topology</h3><p>Two API coordinators, a singleton Git repository role, PostgreSQL, Redis and authenticated S3-compatible storage. Supply a private environment file, pinned platform images, persistent volumes, TLS and isolated workers.</p><pre>{`docker build -f deploy/runtime/Dockerfile \\
  -t quire-owned-app:release .
docker compose --env-file "\${COMPOSE_ENV:?Set your private compose.env path}" \\
  -f deploy/compose/compose.yaml config --quiet
docker compose --env-file "$COMPOSE_ENV" \\
  -f deploy/compose/compose.yaml up --build --wait --wait-timeout 180`}</pre><p>The supplied image manifest pins target Linux/amd64. Other platforms need verified image references. API ports bind loopback; provide your own TLS reverse proxy.</p><a href="#deployment-guides">Download the definition and deployment guide</a></div> },
        { value: "helm", label: "Kubernetes (Helm)", content: <div className="qm-install-note"><h3>Repository Helm chart</h3><p>The chart ships in <code>deploy/helm</code>; no public chart repository is assumed. Your values file must supply the verified application image, runtime/TLS/signing secrets and shared backup storage described in the guide.</p><pre>{`helm lint deploy/helm \\
  -f "\${QUIRE_HELM_VALUES:?Set your operator values file}"
helm template quire-owned deploy/helm -f "$QUIRE_HELM_VALUES"
helm install quire-owned deploy/helm \\
  --namespace "\${QUIRE_NAMESPACE:?Set your owned namespace}" \\
  -f "$QUIRE_HELM_VALUES" --wait --wait-for-jobs --timeout 5m`}</pre><p>Provision cluster storage, database/Redis/S3 endpoints, ingress/TLS and worker isolation before installation. This is a source chart, not a claim of a published release or a configured cluster.</p><a href="#deployment-guides">Download chart metadata and the deployment guide</a></div> },
      ]} /></div>
    </div></section>
    <section id="deployment-guides" className="qm-wrap qm-section" aria-label="Deployment files and guides"><h2>Files from this source build</h2><p className="qm-lead">Download the actual repository guides and definitions. They contain configuration requirements, not credentials or a preconfigured production release.</p><ul className="qm-file-list">
      <li><a href={deploymentRunbook} download="deployment.md">Deployment runbook</a></li>
      <li><a href={installationRunbook} download="installation.md">Installation and update runbook</a></li>
      <li><a href={composeDefinition} download="compose.yaml">Compose definition</a></li>
      <li><a href={helmChart} download="Chart.yaml">Helm chart definition</a></li>
      <li><a href={helmValues} download="values.yaml">Helm values</a></li>
    </ul><p className="qm-note">Controller-owned signed updates are supported for the verified <code>systemd-local-v1</code> driver. Compose and Helm reject that signed-update driver; follow their documented operator deployment and recovery procedures instead.</p></section>
    <section className="qm-wrap qm-section"><h2>One edition. Your infrastructure.</h2><p className="qm-lead">Local and server capabilities are unlocked. Your operator controls deployment, provider access and project policy.</p><div className="qm-grid qm-edition-grid">
      <article className="qm-card"><h3>Quire Server</h3><p className="qm-price">Unbilled</p><p>No license key · no commercial seat limit</p><ul className="qm-grid qm-two">{["Source, Split, Visual and PDF views", "Co-editing, comments and review", "Track changes and version history", "Real project Git repositories", "Optional configured AI provider", "Configured institutional identity", "Templates and installed TeX environments", "Administrative policy and audit"].map(item => <li key={item}>{item}</li>)}</ul><a className="qm-link-button" href="#install">Install guide</a></article>
      <article className="qm-card qm-tonal"><h3>Support plan</h3><p className="qm-price">Not configured</p><p>Installation assistance, response times and service scope require a separate operator agreement.</p><a className="qm-link-button" href="#support">Ask about support</a></article>
    </div></section>
    <section id="requirements" className="qm-band"><div className="qm-wrap qm-section qm-split"><div><h2>What runs on your server</h2><p className="qm-lead">The default profile uses one Bun API/realtime coordinator, a React web build and a separate isolated compile worker.</p><dl><dt>Runtime</dt><dd>Bun 1.4.4, Git and Linux for isolated compilation. Building the web client also requires the Node.js version declared by the repository.</dd><dt>Compilation</dt><dd>TeX Live, latexmk and a verified bwrap or Docker sandbox, including the configured resource-containment prerequisites</dd><dt>Storage</dt><dd>Writable persistent SQLite WAL, blobs and repository directories; or the configured PostgreSQL/Redis/S3 scale profile</dd><dt>Hardware</dt><dd>No measured production sizing recommendation yet. Compile budgets are configurable; the default job memory budget is 1 GiB.</dd></dl></div><div className="qm-grid qm-two">{[
      ["Web & API", "Browser UI and Bun HTTP coordinator"],
      ["Real-time sync", "Authorized collaborative document transport"],
      ["Git repositories", "Local repository objects and working checkpoints"],
      ["Compile workers", "Installed TeX Live in verified isolation"],
      ["AI gateway", "Optional configured endpoint and model"],
      ["SQLite · local disk", "Default durable records and content-addressed blobs"],
      ["Scale profile", "Implemented PostgreSQL, Redis and S3 roles; supply your own endpoints, storage and credentials"],
      ["Identity provider", "SAML, OIDC or LDAP credentials and configuration"],
    ].map(([name, text]) => <article className="qm-card" key={name}><h3>{name}</h3><p>{text}</p></article>)}</div></div></section>
    <section id="ai" className="qm-wrap qm-section qm-split"><div><span className="qm-eyebrow">AI on your terms</span><h2>Bring your own model - or none</h2><p className="qm-lead">Point the assistant at a model running in your data centre, at an approved provider, or leave it unconfigured.</p><ul><li>External requests depend on your chosen endpoint and policy</li><li>Credentials are configured by the operator</li><li>Citation search needs its own provider configuration</li></ul></div><article className="qm-card"><h3>Provider configuration</h3><p>No model or provider health is assumed. Administrators can configure and test the actual endpoint in the admin console.</p><a href="/admin/providers">Open provider settings</a></article></section>
    <section className="qm-wrap qm-section qm-airgap"><h2>Build a signed offline bundle</h2><p className="qm-lead">The repository tooling creates and verifies signed package/image bundles. Prepare the pinned runtime, installed dependencies, selected images and executed environment manifests on a connected producer using your own Ed25519 signing key.</p><pre>{`BUN="$PWD/node_modules/.bin/bun"
"$BUN" scripts/ops/airgap.ts create --source "$PWD" \\
  --output "\${QUIRE_BUNDLE:?Choose a new bundle directory}" --bun "$BUN" \\
  --signing-key "\${QUIRE_SIGNING_KEY:?Set your private signing key}" \\
  --environments "\${QUIRE_ENVIRONMENTS:?Set executed environment manifests}" \\
  --image "\${QUIRE_APPLICATION_IMAGE:?Set your verified application image}" \\
  --image "\${QUIRE_POSTGRES_IMAGE:?Set your PostgreSQL image}" \\
  --image "\${QUIRE_REDIS_IMAGE:?Set your Redis image}" \\
  --image "\${QUIRE_S3_IMAGE:?Set your S3 image}" \\
  --image "\${QUIRE_TOOLCHAIN_IMAGE:?Set your verified toolchain image}"
"$BUN" scripts/ops/airgap.ts verify "$QUIRE_BUNDLE" \\
  --public-key "\${QUIRE_TRUSTED_KEY:?Set the separately trusted public key}"`}</pre><p>Transfer the bundle and separately trusted public key through your approved process. The deployment guide covers verification, image loading, installation and recovery. Private signing keys and production secrets/data are not included. Offline packaging does not make external identity, model or reference services available offline.</p><a href="#deployment-guides">Get the offline and recovery instructions</a></section>
    <SupportForm {...props} />
  </>;
}
