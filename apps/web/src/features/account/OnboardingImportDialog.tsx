import type { Project } from "@quire/contracts";
import { Button, Modal } from "../../ui";
import { NewProjectDialog } from "../projects/NewProjectDialog";
import { Notice, useAction } from "./shared";
import type { AccountPageProps } from "./shared";
import { useOnboardingImport } from "./onboarding-import";

export function OnboardingImportDialog(props: AccountPageProps & {
  readonly onClose: () => void;
  readonly onCreated: (project: Project) => void;
}) {
  const bridge = useOnboardingImport(props);
  const action = useAction();
  if (bridge.loading || !bridge.continuation) return <Modal open title="New project" onClose={props.onClose}>
    {bridge.loading ? <p role="status">Loading saved import...</p> : <>
      <Notice error={bridge.error || action.error} message="" />
      <p>Choose import as your onboarding starting point to continue here.</p>
      <Button onClick={() => { void action.run(() => bridge.load()); }}>Reload saved import</Button>
      <a href="/sign-up?step=start">Back to onboarding</a>
    </>}
  </Modal>;
  return <NewProjectDialog open client={props.client} onClose={props.onClose} onCreated={props.onCreated}
    initialMode={bridge.continuation.draft.mode}
    onboardingImport={{ ...bridge.continuation, error: action.error || bridge.continuation.error }}
    navigate={path => { void action.run(() => bridge.navigate(path)); }} />;
}
