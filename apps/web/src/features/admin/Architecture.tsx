import type { ResponseOf, endpoints } from "@quire/contracts";
import { DataView } from "./DataView";

type Overview = ResponseOf<typeof endpoints.adminOverview>;
export function Architecture({ overview }: { readonly overview: Overview }) {
  const api = overview.topology.find(component => component.role === "API");
  const adapters = overview.topology.filter(component => component !== api);
  const height = Math.max(360, adapters.length * 132 + 96);
  const nodes = [
    ...(api ? [{ ...api, x: 48, y: height / 2 - 48, width: 300 }] : []),
    ...adapters.map((component, index) => ({ ...component, x: 496, y: 48 + index * 132, width: 424 })),
  ];
  return <>
    <h1>Server architecture</h1>
    <p>Components reported by this instance. Adapter configuration does not establish
      provider health, network connectivity, replication, or a multi-host deployment.</p>
    {nodes.length === 0 ? <p role="status">No topology has been reported.</p> : <>
      <figure className="admin-architecture">
        <svg viewBox={`0 0 968 ${height}`} role="img"
          aria-labelledby="admin-architecture-title admin-architecture-description">
          <title id="admin-architecture-title">Reported Quire components</title>
          <desc id="admin-architecture-description">The API and its configured adapters,
            using this server's reported backend and state values. Connections show
            application composition, not measured network links or health.</desc>
          {api && adapters.map((component, index) => <path key={`${component.role}-${index}`}
            d={`M348 ${height / 2}H420V${96 + index * 132}H496`} className="admin-edge" />)}
          {nodes.map((node, index) => <g key={`${node.role}-${index}`}>
            <rect x={node.x} y={node.y} width={node.width} height={96} rx="10"
              className={node.role === "API" ? "admin-node admin-node-dark" : "admin-node"} />
            <text x={node.x + node.width / 2} y={node.y + 27} textAnchor="middle"
              className={node.role === "API" ? "admin-svg-inverse" : ""}>{node.role}</text>
            <text x={node.x + node.width / 2} y={node.y + 53} textAnchor="middle"
              className={node.role === "API" ? "admin-svg-inverse admin-svg-detail" : "admin-svg-detail"}>{node.backend}</text>
            <text x={node.x + node.width / 2} y={node.y + 77} textAnchor="middle"
              className={node.role === "API" ? "admin-svg-inverse admin-svg-detail" : "admin-svg-detail"}>Reported: {node.state}</text>
          </g>)}
        </svg>
        <figcaption>Reported adapters only. Unreported coordination, ingress, identity,
          model endpoints and worker placement are not inferred.</figcaption>
      </figure>
      <ol className="admin-architecture-mobile">{overview.topology.map((component, index) =>
        <li key={`${component.role}-${index}`}><strong>{component.role}</strong>: {component.backend}
          <p>Reported: {component.state}</p></li>)}</ol>
    </>}
    <h2>Reported topology</h2><DataView value={overview.topology} />
    <h2>Reported capabilities</h2><DataView value={overview.capabilities} />
  </>;
}
