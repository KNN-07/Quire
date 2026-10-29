import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { fixture } from "./harness";

export async function acceptManagement(app: Awaited<ReturnType<typeof fixture>>, resourceId: string) {
  const organizationId = IdSchema.parse(app.deployment.organizationId);
  const account = z.object({ id: z.string(), primary_email: z.string(), external_id: z.string() }).parse(
    await app.runtime.db.get("SELECT u.id,u.primary_email,r.external_id FROM users u JOIN federation_resources r ON r.user_id=u.id WHERE r.id=?", [resourceId]));
  await app.runtime.db.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',0,?) ON CONFLICT DO NOTHING",
    [crypto.randomUUID(), organizationId, account.id, app.runtime.clock.now()]);
  const operator = await app.login();
  const organization = z.object({ version: z.number() }).parse(await app.runtime.db.get("SELECT version FROM organizations WHERE id=?", [organizationId]));
  const invited = await app.request(`/api/organizations/${organizationId}/managed/invite`, { method: "POST",
    headers: { ...operator.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ userId: account.id, expectedVersion: organization.version }) });
  if (!invited.ok) throw new TypeError(await invited.text());
  app.provider.state.subject = account.external_id;
  app.provider.state.email = account.primary_email;
  const begin = await app.begin();
  const loggedIn = await app.request(begin.path, { headers: { cookie: begin.cookie } });
  if (loggedIn.status !== 303) throw new TypeError(await loggedIn.text());
  const cookie = loggedIn.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
  const me = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await (await app.request("/api/me", { headers: { cookie } })).json());
  const invitation = z.object({ id: z.string(), version: z.number() }).parse(
    await app.runtime.db.get("SELECT id,version FROM managed_acceptances WHERE user_id=? AND organization_id=?", [account.id, organizationId]));
  const accepted = await app.request(`/api/managed/${invitation.id}/accept`, { method: "POST",
    headers: { cookie, "x-csrf-token": me.data.csrfToken, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ expectedVersion: invitation.version }) });
  if (!accepted.ok) throw new TypeError(await accepted.text());
  return { account, operator, headers: { cookie, "x-csrf-token": me.data.csrfToken } };
}
