import { useState } from "react";
import { Button } from "../../ui";

/** Structured server values remain selectable; credentials require deliberate reveal. */
export function DataView({ value }: { readonly value: unknown }) {
  const [reveal, setReveal] = useState(false);
  if (value === null || value === undefined) return <span className="admin-muted">Not set</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value !== "object") return <span>{typeof value === "string" ? value : JSON.stringify(value)}</span>;
  if (Array.isArray(value)) {
    const rows: readonly unknown[] = value;
    if (rows.length === 0) return <p>No records returned.</p>;
    if (rows.every((row): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row))) {
      const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
      return <table className="admin-table"><thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={typeof row["id"] === "string" ? row["id"] : index}>{columns.map(column => <td key={column} data-label={column}><DataView value={row[column]} /></td>)}</tr>)}</tbody></table>;
    }
    return <ol className="admin-records">{rows.map((row, index) => <li key={index}><DataView value={row} /></li>)}</ol>;
  }
  return <dl className="admin-values">{Object.entries(value).map(([name, item]) => <div key={name}>
    <dt>{name.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt>
    <dd>{/secret|token|password/i.test(name) && !/present/i.test(name)
      ? <><Button onClick={() => setReveal(!reveal)}>{reveal ? "Hide credential" : "Reveal credential"}</Button>{reveal && <code>{String(item)}</code>}</>
      : <DataView value={item} />}</dd>
  </div>)}</dl>;
}
