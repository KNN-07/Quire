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
    </footer>
  </div>;
}

function PolicyPage({ path }: { readonly path: string }) {
  return <section className="qm-wrap qm-section qm-prose">
    <h1>{path === "/terms" ? "Terms" : path === "/privacy" ? "Privacy" : "Security"}</h1>
    {path === "/privacy" ? <>
      <p>This page describes Quire&apos;s default data handling. Your installation operator is responsible for its storage,
        retention settings and external providers. An installation-specific processor list and privacy policy are not published here.</p>
      <h2>Sign-in and browser storage</h2>
      <p>Signing in sets an HttpOnly session cookie with a seven-day expiry. Server-side expiry and revocation can end access earlier.
        The cookie uses SameSite=Lax and is marked Secure when the installation uses HTTPS.</p>
      <p>This browser can remember editor layout, Python configuration, Dropbox selections and operation IDs.
        A public billing-plan selection expires after 24 hours and is removed when next read.
        Onboarding screen hints and AI run IDs use session storage.</p>
      <p>Track Changes recovery stores private draft text in this browser&apos;s session storage.
        Signing out does not clear all browser storage, and browser session restoration may retain it.
        Clearing site data can discard unsubmitted drafts; it does not delete server projects or provider copies.</p>
      <h2>Analytics and extensions</h2>
      <p>Quire does not include an advertising or website-analytics integration. There is no analytics-consent switch in this application.
        Your operator may separately configure proxy logs or extensions; ask which data those additions collect.</p>
      <p>Browser Python is opt-in. Only selected inputs are copied to its worker, but scripts you run can use browser networking.</p>
      <h2>External providers</h2>
      <p>Configured identity, AI, mail, Git, reference, Dropbox, billing and publisher services have their own processing terms.
        Connecting a service or sending content can disclose data to that provider. Configuration does not establish its retention,
        training policy or processing location.</p>
      <p>AI requests require the current configured consent version. Operator AI request logging defaults to off;
        that setting does not erase existing conversations or disable account security and audit records.</p>
      <h2>Export and deletion</h2>
      <p>Account export contains account metadata, not a complete project backup. Project source and history exports are separate.
        Session secrets, passwords and provider credentials are excluded from the account export.
        Account deletion and managed-account recovery have their own ownership and authorization requirements.</p>
      <p>Ask your operator for the applicable retention periods, processor list and a contact for access or deletion requests.</p>
    </> : <p>{path === "/terms" ? "This local installation is operated by its administrator. Commercial terms and support commitments are not configured by Quire." :
      "The local profile stores SQLite records and content-addressed files on the server. Compilation requires an isolated worker; no unsandboxed fallback is supported. Deployment security, TLS, backups and external provider credentials are the operator's responsibility."}</p>
    }
    <a href="/self-hosting#support">Contact your operator</a>
  </section>;
}
