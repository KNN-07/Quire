import { useCallback, useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { ResponseOf } from "@quire/contracts";
import { Button, Field } from "../../../ui";
import { Notice, unwrap, useAction, value } from "../shared";
import type { SettingsProps } from "../settings";

export function InstitutionReconfirmationSettings(props: SettingsProps & { readonly organizationId: string }) {
  const [policy, setPolicy] = useState<ResponseOf<typeof endpoints.institutionPolicyGet> | null>(null);
  const action = useAction();
  const load = useCallback(async (signal?: AbortSignal) => {
    setPolicy(unwrap(await props.client.call(endpoints.institutionPolicyGet, {
      params: { o: props.organizationId }, query: {}, body: undefined,
    }, signal)));
  }, [props.client, props.organizationId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted && cause instanceof Error) action.setError(cause.message);
    });
    return () => controller.abort();
  }, [load, action.setError]);
  return <section className="account-stack" aria-label="Institution reconfirmation">
    <h3>Institution reconfirmation</h3>
    <p>Choose an optional period in days. Leave it blank for no scheduled expiry on future enrollment or reconfirmation.
      Changes apply when users next enroll or reconfirm; existing deadlines remain unchanged.</p>
    <p>Reconfirmation checks the account's currently stored verified email against configured domains.
      It does not obtain new proof of email ownership or contact an identity provider.
      Expiry removes only ordinary unlicensed institution membership; users keep their accounts and projects.</p>
    <Notice {...action} />
    {policy && <form key={policy.version} className="account-form" aria-label="Institution reconfirmation policy" onSubmit={event => {
      event.preventDefault();
      const days = value(new FormData(event.currentTarget), "days").trim();
      void action.run(async () => {
        setPolicy(unwrap(await props.client.call(endpoints.institutionPolicyPut, {
          params: { o: props.organizationId }, query: {},
          body: { reconfirmationDays: days ? Number(days) : null, expectedVersion: policy.version },
        })));
        action.setMessage("Institution reconfirmation policy saved.");
      });
    }}>
      <Field label="Reconfirmation period in days" name="days" type="number" min={1} max={36500} step={1}
        defaultValue={policy.reconfirmationDays ?? ""} />
      <Button type="submit" busy={action.busy}>Save reconfirmation policy</Button>
    </form>}
    <Button busy={action.busy} onClick={() => void action.run(() => load())}>Refresh reconfirmation policy</Button>
  </section>;
}
