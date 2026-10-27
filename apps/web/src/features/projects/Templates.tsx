import { useCallback, useState } from "react";
import type { TemplateVersion } from "@quire/contracts";
import { Button, EmptyState, Field, Icon, Spinner } from "../../ui";
import { loadTemplates, useResource } from "./api";
import type { ProjectsPageProps } from "./api";

export function TemplateBrowser({ client, onChoose, compact = false, externalQuery = "", selection }: {
  readonly client: ProjectsPageProps["client"];
  readonly onChoose: (template: TemplateVersion) => void;
  readonly compact?: boolean;
  readonly externalQuery?: string;
  readonly selection?: string;
}) {
  const resource = useResource(useCallback((signal: AbortSignal) => loadTemplates(client, signal), [client]));
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selected, setSelected] = useState("");
  const templates = resource.data ?? [];
  const categories = ["All", ...new Set(templates.map(template => template.category))];
  const visible = templates.filter(template =>
    (category === "All" || template.category === category) &&
    `${template.name} ${template.description}`.toLowerCase().includes(query.toLowerCase()) &&
    `${template.name} ${template.description}`.toLowerCase().includes(externalQuery.toLowerCase()));
  return <section className={`p-templates ${compact ? "p-templates--compact" : ""}`} aria-label="Templates">
    {!compact && <div className="p-heading"><h2>Start from a template</h2></div>}
    <Field label="Search templates" value={query} onChange={event => setQuery(event.target.value)} type="search" />
    <div className="p-cluster" aria-label="Template categories">
      {categories.map(item => <Button key={item} aria-pressed={category === item} variant={category === item ? "dark" : "neutral"} onClick={() => setCategory(item)}>{item}</Button>)}
    </div>
    {resource.loading && <Spinner label="Loading templates" />}
    {resource.error && <div role="alert">{resource.error} <Button onClick={resource.reload}>Retry templates</Button></div>}
    {!resource.loading && !resource.error && visible.length === 0 && <EmptyState title="No templates found" description="Try another search or category." />}
    <div className="p-template-grid">
      {visible.map(template => <button type="button" key={template.id} className="p-template" aria-label={`${compact ? "Select" : "Use"} template ${template.name}`} aria-pressed={(selection ?? selected) === template.id}
        onClick={() => { setSelected(template.id); onChoose(template); }}>
        <span className="p-template__preview" aria-hidden="true"><span className="p-template__paper"><span /><span /><span /></span></span>
        <span className="p-template__text"><strong>{template.name}</strong><span>{template.description}</span><small>{template.category} · {template.license} · {template.visibility}</small>{(selection ?? selected) === template.id && <span><Icon name="check" /> Selected</span>}</span>
      </button>)}
    </div>
  </section>;
}
