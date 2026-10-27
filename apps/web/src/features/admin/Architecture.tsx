import type { ResponseOf, endpoints } from "@quire/contracts";
import { DataView } from "./DataView";

type Overview = ResponseOf<typeof endpoints.adminOverview>;
const nodes = [
  { id: "browser", x: 64, y: 352, w: 200, h: 72, title: "Browser", detail: "editor, PDF, admin" },
  { id: "git-cli", x: 64, y: 488, w: 200, h: 72, title: "Git CLI", detail: "smart HTTP client" },
  { id: "ingress", x: 360, y: 280, w: 200, h: 352, title: "Local HTTP listener", detail: "TLS proxy not assumed" },
  { id: "api", x: 676, y: 280, w: 240, h: 72, title: "Web & API", detail: "Bun coordinator" },
  { id: "sync", x: 676, y: 420, w: 240, h: 72, title: "Real-time sync", detail: "Yjs / durable updates" },
  { id: "git", x: 676, y: 560, w: 240, h: 72, title: "Git server", detail: "per-project repositories" },
  { id: "workers", x: 676, y: 720, w: 240, h: 72, title: "Compile workers", detail: "isolated process role" },
  { id: "ai", x: 360, y: 720, w: 200, h: 72, title: "AI gateway", detail: "policy / provider boundary" },
  { id: "sqlite", x: 1012, y: 280, w: 240, h: 72, title: "SQLite WAL", detail: "identities, jobs, documents" },
  { id: "events", x: 1012, y: 420, w: 240, h: 72, title: "Local coordination", detail: "SQLite / process events" },
  { id: "disk", x: 1012, y: 560, w: 240, h: 72, title: "Disk blobs & Git", detail: "content-addressed files" },
  { id: "identity", x: 676, y: 128, w: 240, h: 72, title: "Identity provider", detail: "optional SAML / OIDC / LDAP" },
  { id: "model", x: 64, y: 720, w: 200, h: 72, title: "Model endpoint", detail: "optional configured provider" },
] as const;
const lines = [
  "M264 388H360", "M264 524H360", "M560 316H676", "M560 456H676",
  "M560 596H676", "M916 316H1012", "M916 456H1012", "M916 596H1012",
  "M796 632V720", "M460 632V720", "M360 756H264", "M796 280V200",
  "M916 756H1132V632",
] as const;
export function Architecture({ overview }: { readonly overview: Overview }) {
  return <>
    <h1>Server architecture</h1>
    <p>Default local profile reference, not a health report. The live topology returned by this server appears below.</p>
    <figure className="admin-architecture">
      <svg viewBox="0 0 1440 880" role="img" aria-labelledby="admin-architecture-title admin-architecture-description">
        <title id="admin-architecture-title">Local Quire topology</title>
        <desc id="admin-architecture-description">Browser and Git CLI connect to the Bun coordinator. SQLite stores durable state. Disk stores blobs and project Git repositories. Identity and model providers are optional. Compile workers are isolated. No PostgreSQL, Redis or S3 deployment is assumed.</desc>
        <rect x="328" y="248" width="956" height="576" rx="16" className="admin-boundary" />
        <text x="344" y="270" className="admin-svg-label">LOCAL INFRASTRUCTURE</text>
        <defs><marker id="admin-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="currentColor" /></marker></defs>
        {lines.map(path => <path key={path} d={path} className="admin-edge" markerEnd="url(#admin-arrow)" />)}
        {nodes.map(node => <g key={node.id}>
          <rect x={node.x} y={node.y} width={node.w} height={node.h} rx="10"
            className={node.id === "ingress" ? "admin-node admin-node-dark" : `admin-node${node.id === "identity" || node.id === "model" ? " admin-external" : ""}`} />
          <text x={node.x + node.w / 2} y={node.y + node.h / 2 - 4} textAnchor="middle" className={node.id === "ingress" ? "admin-svg-inverse" : ""}>{node.title}</text>
          <text x={node.x + node.w / 2} y={node.y + node.h / 2 + 18} textAnchor="middle" className={node.id === "ingress" ? "admin-svg-inverse admin-svg-detail" : "admin-svg-detail"}>{node.detail}</text>
        </g>)}
        <text x="280" y="368" className="admin-svg-detail">HTTP</text>
        <text x="280" y="504" className="admin-svg-detail">Git</text>
        <text x="808" y="236" className="admin-svg-detail">SSO</text>
        <text x="808" y="680" className="admin-svg-detail">builds</text>
        <text x="472" y="680" className="admin-svg-detail">prompts</text>
      </svg>
      <figcaption>SQLite WAL + local content-addressed blobs + real per-project Git. PostgreSQL, Redis and S3 belong only to an explicitly configured scale profile.</figcaption>
    </figure>
    <ol className="admin-architecture-mobile">{nodes.map(node => <li key={node.id}><strong>{node.title}</strong>: {node.detail}</li>)}</ol>
    <h2>Reported topology</h2><DataView value={overview.topology} />
    <h2>Reported capabilities</h2><DataView value={overview.capabilities} />
  </>;
}
