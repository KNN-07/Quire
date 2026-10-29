import type { ReactNode } from "react";
import type { AiRun, AiRunStep } from "@quire/contracts";
import { Icon } from "../../../ui";
import type { IconName } from "../../../ui";

const stageLabels: Record<AiRunStep["kind"], string> = {
  context: "Collect context",
  retrieval: "Retrieve sources",
  provider: "Generate response",
  validation: "Validate result",
  publication: "Publish result",
};
const stepStates: Record<AiRunStep["status"], { readonly label: string; readonly icon: IconName }> = {
  running: { label: "Running", icon: "play" },
  succeeded: { label: "Completed", icon: "check" },
  failed: { label: "Failed", icon: "warning" },
  canceled: { label: "Canceled", icon: "close" },
};
const runStates: Record<AiRun["status"], string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Result ready",
  failed: "Failed",
  canceled: "Canceled",
  timeout: "Timed out",
};

function RecordedTime({ value }: { readonly value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })}</time>;
}

export function AssistantRunProgress({ run, children }: {
  readonly run: Pick<AiRun, "id" | "mode" | "status" | "version" | "steps">;
  readonly children?: ReactNode;
}) {
  const active = run.steps.find(step => step.status === "running");
  return <section className="qa-assistant__progress" aria-label="Run progress"
    data-run-id={run.id} data-run-status={run.status} data-run-version={run.version}
    data-result-ready={run.status === "succeeded"} data-step-history={run.steps.length ? "recorded" : "unavailable"}>
    <header>
      <h3>{run.mode === "agent" ? "Agent" : "Ask"} run</h3>
      {run.steps.length > 0 && <span className="qa-assistant__progress-meta">{run.steps.length} {run.steps.length === 1 ? "step" : "steps"}</span>}
      <p className="qa-assistant__progress-summary" role="status" aria-atomic="true">
        {runStates[run.status]}{active ? ` · ${stageLabels[active.kind]}` : ""}
      </p>
    </header>
    {(run.status === "failed" || run.status === "timeout") && <p className="qa-assistant__progress-note">This run stopped before publishing a result.
      No edits were applied by this run. Review the error in Run details, check your message and selected context,
      then use <strong>Regenerate (new use)</strong> to start a new request. If it fails again, ask an administrator
      to check the provider and project policy.</p>}
    {run.status === "succeeded" && run.mode === "agent" && <p className="qa-assistant__progress-note">Generation does not accept proposed edits.</p>}
    {run.steps.length ? <>
      <ol className="qa-assistant__steps" aria-label="Recorded run steps" role="list">
        {run.steps.map(step => <li key={step.kind} data-step-kind={step.kind} data-step-status={step.status}
          data-started-at={step.startedAt} data-finished-at={step.finishedAt ?? ""}>
          <span className="qa-assistant__step-icon"><Icon name={stepStates[step.status].icon} size={12} /></span>
          <span>{stageLabels[step.kind]}</span>
          <span className="qa-assistant__step-status">{stepStates[step.status].label}</span>
        </li>)}
      </ol>
    </> : <p className="qa-assistant__progress-note">No step history was recorded for this run.</p>}
    <div className="qa-assistant__progress-footer">
      {run.steps.length > 0 && <details className="qa-assistant__step-times">
        <summary>Recorded times</summary>
        <dl>{run.steps.map(step => <div key={step.kind}>
          <dt>{stageLabels[step.kind]}</dt>
          <dd>Started <RecordedTime value={step.startedAt} />
            {step.finishedAt && <><br />Finished <RecordedTime value={step.finishedAt} /></>}</dd>
        </div>)}</dl>
      </details>}
      {children}
    </div>
  </section>;
}
