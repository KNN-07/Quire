import { Tabs } from "../../ui";
import { SupportForm } from "./support";
import type { MarketingPageProps } from "./types";

export const nativeInstallCommands = `git clone https://github.com/KNN-07/Quire.git
cd Quire
bun install --frozen-lockfile
bun run db:migrate
bun run seed
bun run doctor
bun run dev`;

export function SelfHosting(props: MarketingPageProps) {
  return <>
    <section className="qm-dark"><div className="qm-wrap qm-section qm-server-hero qm-split">
      <div><span className="qm-eyebrow">Quire Server · free to self-host</span><h1>Host it yourself.<br />Get everything, free.</h1><p className="qm-lead">The editor, git, identity and optional AI integrations, on servers you control. No license key or commercial feature gates; capabilities still require their runtime dependencies.</p><div className="qm-actions"><a className="qm-link-button" href="#install">Install Quire Server</a><a href="#requirements">Read the requirements</a></div><small>Native Bun 1.3.14 baseline · Local SQLite and disk</small></div>
      <div id="install" className="qm-install"><Tabs label="Install method" defaultValue="native" items={[
        { value: "native", label: "Native", content: <><pre>{nativeInstallCommands}</pre><p>Run from the repository root. Open http://localhost:5173. Seed prints a generated local password once.</p></> },
        { value: "compose", label: "Docker Compose", content: <div className="qm-install-note"><h3>Deployment artifact pending</h3><p>The native source build above is available. A verified Compose release bundle is not published by this screen. The deployment lane must supply its compose file, image references, environment settings and restore procedure before these commands can be shown as supported.</p><a href="#support">Ask about deployment requirements</a></div> },
        { value: "helm", label: "Kubernetes (Helm)", content: <div className="qm-install-note"><h3>Deployment artifact pending</h3><p>No published Helm repository or chart version is assumed. Kubernetes deployment needs verified charts, persistent storage, ingress/TLS, worker isolation and database configuration from the deployment lane.</p><a href="#support">Describe your cluster</a></div> },
      ]} /></div>
    </div></section>
    <section className="qm-wrap qm-section"><h2>One edition. Every feature. Free.</h2><p className="qm-lead">Local and server capabilities are unlocked. Your operator controls deployment, provider access and project policy.</p><div className="qm-grid qm-edition-grid">
      <article className="qm-card"><h3>Quire Server</h3><p className="qm-price">Unbilled</p><p>No license key · no commercial seat limit</p><ul className="qm-grid qm-two">{["Source, Split, Visual and PDF views", "Co-editing, comments and review", "Track changes and version history", "Real project Git repositories", "Optional configured AI provider", "Configured institutional identity", "Templates and installed TeX environments", "Administrative policy and audit"].map(item => <li key={item}>{item}</li>)}</ul><a className="qm-link-button" href="#install">Install guide</a></article>
      <article className="qm-card qm-tonal"><h3>Support plan</h3><p className="qm-price">Not configured</p><p>Installation assistance, response times and service scope require a separate operator agreement.</p><a className="qm-link-button" href="#support">Ask about support</a></article>
    </div></section>
    <section id="requirements" className="qm-band"><div className="qm-wrap qm-section qm-split"><div><h2>What runs on your server</h2><p className="qm-lead">The default profile uses one Bun API/realtime coordinator, a React web build and a separate isolated compile worker.</p><dl><dt>Runtime</dt><dd>Bun 1.3.14, Git, Linux for isolated compilation</dd><dt>Compilation</dt><dd>TeX Live, latexmk and a verified bwrap or Docker sandbox</dd><dt>Storage</dt><dd>Writable persistent SQLite WAL, blobs and repository directories</dd><dt>Hardware</dt><dd>No measured production sizing recommendation yet. Compile budgets are configurable; the default job memory budget is 1 GiB.</dd></dl></div><div className="qm-grid qm-two">{[
      ["Web & API", "Browser UI and Bun HTTP coordinator"],
      ["Real-time sync", "Authorized collaborative document transport"],
      ["Git repositories", "Local repository objects and working checkpoints"],
      ["Compile workers", "Installed TeX Live in verified isolation"],
      ["AI gateway", "Optional configured endpoint and model"],
      ["SQLite · local disk", "Default durable records and content-addressed blobs"],
      ["Scale profile", "PostgreSQL, Redis and S3 require deployment integration"],
      ["Identity provider", "SAML, OIDC or LDAP credentials and configuration"],
    ].map(([name, text]) => <article className="qm-card" key={name}><h3>{name}</h3><p>{text}</p></article>)}</div></div></section>
    <section id="ai" className="qm-wrap qm-section qm-split"><div><span className="qm-eyebrow">AI on your terms</span><h2>Bring your own model - or none</h2><p className="qm-lead">Point the assistant at a model running in your data centre, at an approved provider, or leave it unconfigured.</p><ul><li>External requests depend on your chosen endpoint and policy</li><li>Credentials are configured by the operator</li><li>Citation search needs its own provider configuration</li></ul></div><article className="qm-card"><h3>Provider configuration</h3><p>No model or provider health is assumed. Administrators can configure and test the actual endpoint in the admin console.</p><a href="/admin/providers">Open provider settings</a></article></section>
    <section className="qm-wrap qm-section qm-airgap"><h2>Offline and air-gapped deployments</h2><p className="qm-lead">Prepare source, pinned dependencies, TeX packages and any container images on a connected machine. Transfer them using your institution's approved process. No signed offline release bundle or update guarantee is claimed by this source build.</p><a href="#support">Discuss your offline requirements</a></section>
    <SupportForm {...props} />
  </>;
}
