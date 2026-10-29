import { useEffect, useState } from "react";
import { endpoints, IdSchema, OnboardingChoicesSchema } from "@quire/contracts";
import type { Onboarding, TemplateVersion } from "@quire/contracts";
import { Button, Field } from "../../ui";
import { listInput, Notice, readInput, unwrap, useAction } from "./shared";
import type { AccountPageProps } from "./shared";
import { openOnboardingProject, useOnboarding } from "./onboarding-progress";
import { authPath, billingReturnPath, clearBillingReturn } from "./onboarding-return";

export function StartingPoint(props: AccountPageProps & { readonly returnTo?: string | null }) {
  const draft = useOnboarding(props.client);
  const [templates, setTemplates] = useState<readonly TemplateVersion[]>([]);
  const [templateError, setTemplateError] = useState("");
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const action = useAction();
  const billingReturn = billingReturnPath(props.returnTo ?? null, location.origin);
  useEffect(() => {
    const controller = new AbortController();
    void props.client.call(endpoints.templatesList, listInput, controller.signal).then(result => {
      if (!controller.signal.aborted) setTemplates(unwrap(result).items.filter(template => template.status === "approved" || template.status === "published"));
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof Error) setTemplateError(error.message); else throw error;
    }).finally(() => { if (!controller.signal.aborted) setTemplatesLoading(false); });
    return () => controller.abort();
  }, [props.client]);
  if (draft.signedOut) return <><h1>Sign in to continue</h1><p>Your starting point is saved with your account. Verify your email before signing in.</p><a href={authPath("/sign-in?onboarding=1", props.returnTo ?? null)}>Continue to sign in</a></>;
  const { choices, progress } = draft;
  if (!choices || !progress) return <><h1>Pick a starting point</h1>{draft.error
    ? <><Notice error={draft.error} message="" /><Button onClick={draft.reload}>Reload saved choices</Button></>
    : <p role="status">Loading saved choices...</p>}</>;
  const choosing = progress.stage === "choosing";
  const selectedTemplate = choices.origin.kind === "template" ? choices.origin.templateVersionId : null;
  const unavailableTemplate = selectedTemplate && !templates.some(template => template.id === selectedTemplate);
  async function start(saved: Onboarding) {
    let next = saved;
    if (next.stage === "choosing") {
      next = unwrap(await props.client.call(endpoints.onboardingStart, { params: {}, query: {},
        body: { actorId: next.actorId, expectedVersion: next.version },
        headers: { "idempotency-key": `onboarding-start:${next.actorId}:${next.version}` } }));
      draft.accept(next);
    }
    if (next.stage === "import") { props.navigate("/projects?new=import&onboarding=1"); return; }
    if (next.stage === "creating") {
      if (!next.createKey || next.choices.origin.kind === "import") throw new Error("Saved creation request is unavailable.");
      const project = unwrap(await props.client.call(endpoints.projectCreate, { params: {}, query: {},
        body: { name: next.choices.name, origin: next.choices.origin },
        headers: { "idempotency-key": next.createKey } }));
      next = unwrap(await props.client.call(endpoints.onboardingComplete, { params: {}, query: {},
        body: { actorId: next.actorId, expectedVersion: next.version }, headers: { "idempotency-key": next.createKey } }));
      draft.accept(next);
      if (next.projectId !== project.id) throw new Error("Saved project does not match the creation result.");
    }
    await openOnboardingProject(props, next);
  }
  return <><h1>{progress.stage === "complete" ? "Your project is ready" : "What are you writing?"}</h1>
    <p>{progress.stage === "complete" ? "Your first project is saved. Open it again without creating another."
      : choosing ? "Choose a blank document, a published template, or continue to the project importer."
        : progress.stage === "import" ? "Your import choices are saved. Continue to resume the same upload or operation."
        : "Your starting point is saved. Continue the same request without creating a duplicate."}</p>
    {billingReturn && <><Button variant="primary" busy={action.busy} onClick={() => {
      void action.run(async () => {
        const account = unwrap(await props.client.call(endpoints.me, readInput));
        if (account.user.id !== progress.actorId) throw new Error("Account changed; reload onboarding.");
        clearBillingReturn(); props.navigate(billingReturn);
      });
    }}>Continue to selected plan</Button><p>Your starting-point choices stay saved. You do not need to create a project to review billing.</p></>}
    <form className="account-form" onSubmit={event => {
      event.preventDefault();
      void action.run(() => start(progress));
    }}>
      <fieldset disabled={!choosing || action.busy || Boolean(draft.error)}>
        <div className="account-fields" role="group" aria-label="Kind of document">
          {([["paper", "A paper"], ["thesis", "A thesis"], ["slides", "Slides"], ["coursework", "Coursework"]] as const).map(([id, label]) =>
            <Button type="button" key={id} aria-pressed={choices.writingKind === id} className="account-kind"
              onClick={() => draft.save({ ...choices, writingKind: id })}>{label}</Button>)}
        </div>
        <Field label="Project name" name="name" required maxLength={200} value={progress.importState?.draft.name ?? choices.name}
          onChange={event => draft.save({ ...choices, name: event.target.value })} />
        <label className="q-field"><span className="q-field__label" id="onboarding-origin-label">Starting point</span>
          <select className="q-input" name="origin" aria-labelledby="onboarding-origin-label" value={choices.origin.kind === "template" ? choices.origin.templateVersionId : choices.origin.kind}
            onChange={event => {
              const selected = event.target.value;
              draft.save({ ...choices, origin: selected === "blank" || selected === "import"
                ? { kind: selected } : { kind: "template", templateVersionId: IdSchema.parse(selected) } });
            }}>
            <option value="blank">Blank document</option>
            <option value="import">Import an existing project</option>
            {unavailableTemplate && <option value={selectedTemplate} disabled>Saved template unavailable</option>}
            {templates.map(template => <option key={template.id} value={template.id}>{template.name} ({template.category})</option>)}
          </select>
        </label>
        {templatesLoading && <p role="status">Loading templates...</p>}
        {templateError && <p className="account-muted">Templates unavailable: {templateError}. You can still create a blank document.</p>}
        {unavailableTemplate && !templatesLoading && <p role="alert">The saved template is no longer available. Choose another starting point before creating.</p>}
        <label className="q-field"><span className="q-field__label" id="onboarding-view-label">LaTeX experience</span>
          <select className="q-input" name="view" aria-labelledby="onboarding-view-label" value={choices.defaultView} onChange={event =>
            draft.save({ ...choices, defaultView: OnboardingChoicesSchema.unwrap().shape.defaultView.parse(event.target.value) })}>
            <option value="visual">New - open in Visual view</option>
            <option value="split">Some - open in Split view</option>
            <option value="source">Expert - open in Source view</option>
          </select>
        </label>
      </fieldset>
      <p role="status">{draft.pending ? "Saving choices..." : draft.error ? "Choices not saved. Reload the saved version before continuing." : "Choices saved to your account."}</p>
      {choices.origin.kind === "import" && progress.stage !== "complete" && <p>The importer accepts ZIP files, GitHub repositories, and Git URLs. Keep the original file until upload finishes; your saved attempt can resume after a reload.</p>}
      <Notice error={draft.error} message="" /><Notice {...action} />
      {(draft.error || action.error) && <Button type="button" onClick={draft.reload}>Reload saved choices</Button>}
      <Button variant="primary" type="submit" busy={action.busy}
        disabled={draft.pending > 0 || Boolean(draft.error) || choosing && (Boolean(unavailableTemplate) || !choices.name.trim())}>
        {progress.stage === "complete" ? "Open created project" : progress.stage === "creating" ? "Resume project creation"
          : choices.origin.kind === "import" ? "Continue to import" : "Create project"}
      </Button>
      {progress.projectId && action.error && <a href={`/projects/${progress.projectId}/edit`}>Open created project without changing view</a>}
    </form>
    <a href="/projects">Skip for now</a>
  </>;
}
