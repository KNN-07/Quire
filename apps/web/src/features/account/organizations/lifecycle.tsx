import { useCallback, useEffect, useState } from "react";
import { endpoints, ManagedLifecycleSettingsSchema } from "@quire/contracts";
import type { Organization, ResponseOf } from "@quire/contracts";
import { Button, Field } from "../../../ui";
import { Notice, unwrap, useAction, value } from "../shared";
import type { SettingsProps } from "../settings";

type Schedule = ResponseOf<typeof endpoints.managedLifecycleGet>;
type Member = ResponseOf<typeof endpoints.organizationManagementList>["items"][number];
type Props = SettingsProps & {
  readonly organization: Organization; readonly members: readonly Member[];
  readonly canAuthorize: boolean; readonly refreshManaged: () => Promise<void>;
};

export function ManagedLifecycle(props: Props) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [enabled, setEnabled] = useState(false);
  const action = useAction();
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = unwrap(await props.client.call(endpoints.managedLifecycleGet, {
      params: { o: props.organization.id }, query: {}, body: undefined,
    }, signal));
    setSchedule(result); setEnabled(result.settings.enabled);
  }, [props.client, props.organization.id]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted && cause instanceof Error) action.setError(cause.message);
    });
    return () => controller.abort();
  }, [load, props.members, action.setError]);
  const recipients = props.members.filter(member => member.canReceiveProjects);
  return <section className="organization-member account-stack" aria-labelledby="managed-lifecycle-title">
    <h3 id="managed-lifecycle-title">Automatic managed lifecycle</h3>
    <p>Opt in to scheduled logical account deletion after an administrator explicitly starts a lapse.
      This does not infer a lapse from billing or membership and does not securely erase stored data.</p>
    <p>Both intervals are absolute days from the lapse timestamp, not consecutive waiting periods.
      Defaults are soft deletion on day 60 and final account deletion on day 90.
      Due stages run on the host scheduler's next tick; downtime can skip directly to final deletion.</p>
    <Notice {...action} />
    {schedule ? <>
      <p role="status">{!schedule.settings.enabled ? "Schedule disabled. No automatic transitions will run."
        : schedule.authorityValid ? "Schedule enabled. Saved administrator authority is valid."
          : "Schedule blocked. Saved administrator authority was revoked; an organization admin must save it again."}</p>
      <p>Changing the authorizing admin's membership invalidates this grant. Disable the schedule to stop future transitions;
        disabling does not undo an existing suspension or deletion.</p>
      {!props.canAuthorize && <p>Only an active organization administrator can save this schedule. Installation operator status alone is not sufficient.</p>}
      <form key={schedule.version} className="account-form" aria-label="Managed lifecycle schedule" onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void action.run(async () => {
          const settings = ManagedLifecycleSettingsSchema.parse({
            enabled, transferTo: value(form, "transferTo") || null,
            softDeleteDays: Number(value(form, "softDeleteDays")), deletionDays: Number(value(form, "deletionDays")),
          });
          const result = unwrap(await props.client.call(endpoints.managedLifecyclePut, {
            params: { o: props.organization.id }, query: {}, body: { settings, expectedVersion: schedule.version },
          }));
          setSchedule(result); setEnabled(result.settings.enabled);
          action.setMessage("Lifecycle schedule saved.");
        });
      }}>
        <fieldset disabled={!props.canAuthorize || action.busy} className="account-stack">
          <legend>Explicit administrator authorization</legend>
          <label><input name="enabled" type="checkbox" checked={enabled}
            onChange={event => setEnabled(event.currentTarget.checked)} /> Enable automatic managed lifecycle</label>
          <Field label="Soft deletion day from lapse" name="softDeleteDays" type="number" min={1} max={36500}
            step={1} required defaultValue={schedule.settings.softDeleteDays} />
          <Field label="Final deletion day from lapse" name="deletionDays" type="number" min={2} max={36501}
            step={1} required defaultValue={schedule.settings.deletionDays} />
          <label className="q-field"><span className="q-field__label">Scheduled project recipient</span>
            <select className="q-input" name="transferTo" required={enabled} defaultValue={schedule.settings.transferTo ?? ""}>
              <option value="">Choose an accepted managed recipient</option>
              {schedule.settings.transferTo && !recipients.some(member => member.id === schedule.settings.transferTo)
                && <option value={schedule.settings.transferTo}>Saved recipient is no longer eligible</option>}
              {recipients.map(member => <option key={member.id} value={member.id}>{member.name} ({member.email})</option>)}
            </select>
          </label>
          <p>Final deletion requires a distinct active, verified, accepted managed recipient.
            Projects transfer before credentials and sessions are revoked. Last-admin and last-operator guards still apply.</p>
          <Button type="submit" busy={action.busy}>Save lifecycle schedule</Button>
        </fieldset>
      </form>
      {schedule.accounts.map(account => <form key={`${account.userId}:${account.version}`} className="account-form"
        aria-label={`Lifecycle for ${account.email}`} onSubmit={event => {
          event.preventDefault();
          void action.run(async () => {
            unwrap(await props.client.call(endpoints.managedLifecycleTransition, {
              params: { o: props.organization.id, u: account.userId }, query: {},
              body: { action: account.state === "accepted" ? "lapse" : "recover", expectedVersion: account.version },
            }));
            await props.refreshManaged(); await load();
            action.setMessage(account.state === "accepted" ? "Account suspended; lapse started." : "Account recovered; lapse cleared.");
          });
        }}>
        <h4>{account.email}</h4>
        <p>Lifecycle state: {account.state.replaceAll("_", " ")}</p>
        {account.lapseAt && <p>Lapse started: <time dateTime={account.lapseAt}>{account.lapseAt}</time></p>}
        {account.nextAt && <p>{schedule.settings.enabled && schedule.authorityValid ? "Next stage" : "Paused stage"}: {account.nextStage === "soft_deleted" ? "Soft deletion" : "Final account deletion"}
          {" at "}<time dateTime={account.nextAt}>{account.nextAt}</time></p>}
        {account.errorCode && <p role="alert">Last scheduled attempt blocked: {account.errorCode}. Correct the cause before the next tick.</p>}
        {account.state === "accepted" ? <>
          <label><input type="checkbox" required disabled={!schedule.settings.enabled || !schedule.authorityValid}
            name="confirmLapse" /> Confirm suspension and start the lapse for {account.email}</label>
          <Button type="submit" variant="danger" busy={action.busy}
            disabled={!schedule.settings.enabled || !schedule.authorityValid || account.userId === schedule.settings.transferTo}>
            Suspend and start lapse
          </Button>
        </> : <Button type="submit" busy={action.busy}>Recover account</Button>}
      </form>)}
    </> : <p role="status">Loading lifecycle schedule...</p>}
    <Button busy={action.busy} onClick={() => void action.run(() => load())}>Refresh lifecycle schedule</Button>
  </section>;
}
