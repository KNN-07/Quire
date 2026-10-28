import { expect } from "bun:test";
import { z } from "zod";
import { AiRunSchema, BillingAccountSchema, IdSchema, IdentityConfigSchema, OperationSchema, TextDocumentSchema, resourceVersionTag } from "@quire/contracts";
import type { Project } from "@quire/contracts";
import { defaultPolicy } from "../../../services/accounts/identity/policy";
import { emptyConfig } from "../../../services/adapters/federation";
import type { createPostgresStorage } from "../../../services/operations/storage/postgres";
import type { providerServer } from "../../adapters/ai/provider";
import type { stripeFixture } from "../../adapters/billing/provider";
import type { providerFixture } from "../../adapters/federation/oidc-idp";
import { fixtureIds } from "../../fixtures/foundation";
import { eventStream } from "../portable/events";
import type { AdapterApi } from "./api-host";
import { data } from "./harness";

export async function reviewScaleAi(apis: readonly [AdapterApi, AdapterApi], input: {
  readonly project: Project;
  readonly provider: ReturnType<typeof providerServer>;
  readonly storage: Awaited<ReturnType<typeof createPostgresStorage>>;
}) {
  const [first, second] = apis;
  const session = await first.login();
  const project = input.project;
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const path = `/api/projects/${project.id}/files/${project.settings.mainFileId}/document?branch=main`;
  const before = await data(await second.request(path, { headers: session.headers }), TextDocumentSchema);
  await input.storage.uow.run(async tx => {
    await tx.run("INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at) VALUES(?,'project',?,?,?)",
      [crypto.randomUUID(), project.id, JSON.stringify({ ...defaultPolicy, ai: "agent" }), new Date().toISOString()]);
    await tx.run("UPDATE organizations SET policy_json=? WHERE id IN (SELECT organization_id FROM members WHERE user_id=?)",
      [JSON.stringify({ ...defaultPolicy, ai: "agent" }), session.user.id]);
    await tx.run("INSERT INTO identity_ai_consent(user_id,terms_version,accepted,updated_at) VALUES(?,'2026-10-27',1,?)",
      [session.user.id, new Date().toISOString()]);
  });
  input.provider.respond(context => ({ text: "Scale proposal", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% scale approval\n",
  })) }));
  await using events = await eventStream(await second.ready, session.headers);
  const terminal = events.next(event => event.topic === "operation.changed" && event.payload.status === "succeeded");
  const created = await data(await first.request(`/api/projects/${project.id}/ai/runs`, {
    method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, mode: "agent", tool: "texgpt", prompt: "Insert a comment", fileIds: [project.settings.mainFileId] }),
  }), AiRunSchema);
  expect((await terminal).aggregateId).toBe(created.id);
  const generated = await data(await second.request(`/api/ai/runs/${created.id}`, { headers: session.headers }), AiRunSchema);
  expect((await data(await second.request(path, { headers: session.headers }), TextDocumentSchema)).text).toBe(before.text);
  const accepted = await data(await second.request(`/api/ai/runs/${created.id}/decide`, {
    method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ expectedVersion: generated.version, editIds: [], decision: "accept" }),
  }), AiRunSchema);
  expect(accepted.proposals[0]?.edits[0]?.status).toBe("accepted");
  expect((await data(await first.request(path, { headers: session.headers }), TextDocumentSchema)).text).toBe(`% scale approval\n${before.text}`);
  expect(input.provider.received).toHaveLength(1);
}

export async function reconcileScaleBilling(apis: readonly [AdapterApi, AdapterApi], provider: ReturnType<typeof stripeFixture>) {
  const [first, second] = apis;
  const session = await first.login();
  const path = `/api/organizations/${fixtureIds.team}/billing`;
  const write = (api: AdapterApi, suffix: string, body: unknown) => api.request(path + suffix, {
    method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body),
  });
  const quote = await data(await write(first, "/preview",
    { planId: "price_month", seats: 2, period: "month", expectedVersion: 0 }), z.object({ quoteId: IdSchema }));
  const operation = await data(await write(second, "/checkout", { quoteId: quote.quoteId, expectedVersion: 0 }), OperationSchema);
  expect(operation.result?.["url"]).toBe("https://checkout.stripe.com/c/pay/cs_fixture");
  provider.complete();
  const bytes = provider.event("evt_scale_checkout", "checkout.session.completed");
  const webhook = (api: AdapterApi, signature: string) => api.request("/api/webhooks/billing/stripe", {
    method: "POST", body: bytes, headers: { "content-type": "application/json", "stripe-signature": signature },
  });
  expect((await webhook(first, provider.sign(bytes, new Date().toISOString()))).status).toBe(200);
  expect((await webhook(second, provider.sign(bytes, new Date().toISOString()))).status).toBe(200);
  expect((await data(await second.request(path, { headers: session.headers }), BillingAccountSchema)).status).toBe("active");
  expect((await webhook(second, "t=0,v1=forged")).status).toBe(400);
}

export async function admitScaleFederation(apis: readonly [AdapterApi, AdapterApi], provider: Awaited<ReturnType<typeof providerFixture>>) {
  const [first, second] = apis;
  const operator = await first.login("operator@quire.local");
  const { version: _version, ...configuration } = emptyConfig;
  await data(await first.request("/api/admin/identity", {
    method: "PUT", headers: { ...operator.headers, "if-match": resourceVersionTag(0) },
    body: JSON.stringify({ ...configuration, enabled: true, createOnLogin: true,
      breakGlassUserId: fixtureIds.operator, domains: ["example.test"], oidc: {
        issuer: provider.origin, clientId: "google-client", scopes: ["openid", "email", "profile"], secretPresent: true },
      oidcSecret: "fixture-client-secret", expectedVersion: 0 }),
  }), IdentityConfigSchema);
  const start = await first.request("/api/auth/oidc/start?returnTo=/projects", { redirect: "manual" });
  const location = start.headers.get("location");
  if (!location) throw new TypeError(await start.text());
  const authorized = await fetch(location, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  const locationCallback = authorized.headers.get("location");
  if (!locationCallback) throw new TypeError("Federation callback missing");
  const callback = new URL(locationCallback);
  const headers = { cookie: start.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
  const response = await second.request(callback.pathname + callback.search, { headers, redirect: "manual" });
  expect(response.status).toBe(303);
  const cookie = response.headers.getSetCookie().find(value => value.startsWith("quire_session="))?.split(";")[0];
  if (!cookie) throw new TypeError("Federated scale session missing");
  expect((await first.request("/api/me", { headers: { cookie } })).status).toBe(200);
  expect((await first.request(callback.pathname + callback.search, { headers, redirect: "manual" })).status).toBe(400);
}
