import { useEffect, useState } from "react";
import { endpoints, PreferencesSchema } from "@quire/contracts";
import type { TemplateVersion } from "@quire/contracts";
import { Button, Field } from "../../ui";
import { listInput, mutationHeaders, Notice, readInput, Select, unwrap, useAction, value } from "./shared";
import type { AccountPageProps } from "./shared";

export function StartingPoint(props: AccountPageProps) {
  const [templates, setTemplates] = useState<readonly TemplateVersion[]>([]);
  const [templateError, setTemplateError] = useState("");
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [kind, setKind] = useState("paper");
  const action = useAction();
  useEffect(() => {
    const controller = new AbortController();
    void props.client.call(endpoints.templatesList, listInput, controller.signal).then(result =>
      setTemplates(unwrap(result).items.filter(template => template.status === "approved" || template.status === "published"))).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof Error) setTemplateError(error.message); else throw error;
    }).finally(() => { if (!controller.signal.aborted) setTemplatesLoading(false); });
    return () => controller.abort();
  }, [props.client]);
  return <><h1>What are you writing?</h1>
    <div className="account-fields" role="group" aria-label="Kind of document">
      {[["paper", "A paper"], ["thesis", "A thesis"], ["slides", "Slides"], ["coursework", "Coursework"]].map(([id, label]) => <Button key={id} aria-pressed={kind === id} className="account-kind" onClick={() => setKind(id ?? "paper")}>{label}</Button>)}
    </div>
    <form className="account-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action.run(async () => {
        const preferences = unwrap(await props.client.call(endpoints.preferencesGet, readInput));
        const defaultView = PreferencesSchema.unwrap().shape.defaultView.parse(value(form, "view"));
        unwrap(await props.client.call(endpoints.preferencesPatch, { params: {}, query: {}, body: { defaultView, expectedVersion: preferences.version } }));
        const selected = templates.find(template => template.id === value(form, "origin"));
        const project = unwrap(await props.client.call(endpoints.projectCreate, { params: {}, query: {}, body: { name: value(form, "name"), origin: selected ? { kind: "template", templateVersionId: selected.id } : { kind: "blank" } }, headers: mutationHeaders() }));
        props.navigate(`/projects/${project.id}/edit`);
      });
    }}>
      <Field label="Project name" name="name" required defaultValue="My first paper" />
      <Select label="Starting point" name="origin" defaultValue="" options={[["", "Blank document"], ...templates.filter(template => template.category.toLowerCase().includes(kind)).map(template => [template.id, template.name] as const)]} />
      {templatesLoading && <p role="status">Loading templates…</p>}
      {templateError && <p className="account-muted">Templates unavailable: {templateError}. You can still create a blank document.</p>}
      <Select label="LaTeX experience" name="view" defaultValue="split" options={[["visual", "New - open in Visual view"], ["split", "Some - open in Split view"], ["source", "Expert - open in Source view"]]} />
      <Notice {...action} /><Button variant="primary" type="submit" busy={action.busy}>Create project</Button>
    </form>
    <a href="/projects">Skip for now</a><a href="/projects?new=import">Import an existing project</a>
  </>;
}
