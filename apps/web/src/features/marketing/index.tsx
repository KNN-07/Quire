import { BrandMark } from "../../ui";
import { Landing } from "./landing";
import { Pricing } from "./pricing";
import { SelfHosting } from "./self-hosting";
import { Institution } from "./institution";
import type { MarketingPageProps } from "./types";
import "./marketing.css";

export type { MarketingPageProps } from "./types";

export function MarketingPage(props: MarketingPageProps) {
  const path = props.path.split(/[?#]/)[0] ?? "/";
  const content = path === "/pricing" ? <Pricing {...props} /> :
    path === "/self-hosting" ? <SelfHosting {...props} /> :
    path.startsWith("/institutions") ? <Institution {...props} /> :
    path === "/terms" || path === "/privacy" || path === "/security" ? <PolicyPage path={path} /> :
    <Landing />;
  return <div className="qm">
    <header className="qm-header"><div className="qm-nav">
      <a href="/" aria-label="Quire home"><BrandMark /></a>
      <nav aria-label="Main">
        <a href="/#views">Features</a><a href="/#git">Git</a><a href="/#ai">AI assistant</a>
        <a href="/#teams">For organizations</a>
        <a href="/self-hosting" aria-current={path === "/self-hosting" ? "page" : undefined}>Self-hosting</a>
        <a href="/pricing" aria-current={path === "/pricing" ? "page" : undefined}>Pricing</a>
        <a href="/self-hosting#install">Docs</a>
      </nav>
      <a href="/sign-in">Sign in</a>
      <a className="qm-link-button qm-primary" href={path === "/self-hosting" ? "#install" : "/sign-up"}>{path === "/self-hosting" ? "Install" : "Get started"}</a>
    </div></header>
    <main>{content}</main>
    <footer className="qm-footer qm-wrap"><BrandMark />
      <a href="/self-hosting#install">Docs</a><a href="/api/health">Status</a>
      <a href="/security">Security</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a>
      <span>Quire · Local and self-hosted writing</span>
    </footer>
  </div>;
}

function PolicyPage({ path }: { readonly path: string }) {
  return <section className="qm-wrap qm-section qm-prose">
    <h1>{path === "/terms" ? "Terms" : path === "/privacy" ? "Privacy" : "Security"}</h1>
    <p>{path === "/terms" ? "This local installation is operated by its administrator. Commercial terms and support commitments are not configured by Quire." :
      path === "/privacy" ? "Project data and account records are stored in the operator's configured storage. External identity, AI and integration providers process data only when configured and used. Ask your operator for the installation's privacy policy and retention settings." :
      "The local profile stores SQLite records and content-addressed files on the server. Compilation requires an isolated worker; no unsandboxed fallback is supported. Deployment security, TLS, backups and external provider credentials are the operator's responsibility."}</p>
    <a href="/self-hosting#support">Contact your operator</a>
  </section>;
}
