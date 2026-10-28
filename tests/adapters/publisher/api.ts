import { z } from "zod";
import {
  AdapterGrantSchema,
  OperationSchema,
  UserSchema,
} from "@quire/contracts";
import type { Runtime } from "@quire/runtime";
import { defaultPolicy } from "../../fixtures/foundation";
import type { PublisherProvider } from "./provider";

const fixturePassword = "publisher-fixture-password-2026";
const fixtureOrigin = "http://localhost:5173";
const OperationEnvelope = z.object({ data: OperationSchema });
const GrantEnvelope = z.object({
  data: z.object({
    items: z.array(AdapterGrantSchema),
    nextCursor: z.string().nullable(),
  }),
});
export type Session = {
  readonly user: z.infer<typeof UserSchema>;
  readonly headers: Readonly<Record<string, string>>;
};

export function createPublisherApi(runtime: Runtime, provider: PublisherProvider) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (incoming) => runtime.routes.fetch(incoming),
  });
  async function request(route: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("origin")) headers.set("origin", fixtureOrigin);
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(route, server.url), {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(180_000),
    });
  }
  async function login(email = "kien@quire.local"): Promise<Session> {
    const response = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: fixturePassword }),
    });
    const user = z.object({ data: UserSchema }).parse(await response.json()).data;
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Publisher fixture login did not issue a cookie");
    const profile = await request("/api/me", { headers: { cookie } });
    const csrf = z.object({ data: z.object({ csrfToken: z.string() }) })
      .parse(await profile.json()).data.csrfToken;
    return { user, headers: { cookie, "x-csrf-token": csrf } };
  }
  async function configure(session: Session, mode: "manual" | "direct", expectedVersion: number) {
    const common = {
      version: 1,
      mode,
      credentialTestPath: "api/me",
      oauth: {
        authorizationPath: "oauth/authorize",
        tokenPath: "oauth/token",
        revokePath: "oauth/revoke",
        clientId: "publisher-fixture-client",
        scopes: ["submissions:read", "submissions:write"],
        tokenAuthentication: "body",
      },
    };
    const model = mode === "manual" ? common : {
      ...common,
      submitPath: "api/submissions",
      statusPath: "api/submissions/{submissionId}",
      responseFields: {
        submissionId: "submission_id",
        status: "status",
        receipt: "receipt",
      },
    };
    return request("/api/admin/providers/publisher", {
      method: "PUT",
      headers: { ...session.headers, "if-match": `"${expectedVersion}"` },
      body: JSON.stringify({
        baseUrl: provider.origin,
        model: JSON.stringify(model),
        ...(expectedVersion === 0 ? { secret: "publisher-fixture-secret" } : {}),
        policy: defaultPolicy,
        expectedVersion,
      }),
    });
  }
  async function connect(session: Session) {
    const start = await request("/api/connections/publisher/start", {
      method: "POST",
      headers: session.headers,
      body: JSON.stringify({ returnTo: "/settings/connections" }),
    });
    const authorizationUrl = z.object({ data: z.object({ url: z.url() }) })
      .parse(await start.json()).data.url;
    const accepted = await fetch(authorizationUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const location = accepted.headers.get("location");
    if (!location) throw new TypeError("Publisher fixture authorization did not redirect");
    const callback = new URL(location);
    const completed = await request(callback.pathname + callback.search, {
      headers: session.headers,
    });
    if (completed.status !== 303) {
      throw new TypeError(`Publisher fixture connection failed with ${completed.status}`);
    }
    const list = await request("/api/connections", { headers: session.headers });
    const grant = GrantEnvelope.parse(await list.json()).data.items
      .find((candidate) => candidate.provider === "publisher");
    if (!grant) throw new TypeError("Publisher fixture grant missing");
    return grant;
  }
  async function action(input: {
    readonly session: Session;
    readonly grantId: string;
    readonly grantVersion: number;
    readonly projectId: string;
    readonly action: "prepare" | "submit" | "status";
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly key?: string;
  }) {
    return request(`/api/connections/${input.grantId}/actions`, {
      method: "POST",
      headers: {
        ...input.session.headers,
        "idempotency-key": input.key ?? crypto.randomUUID(),
      },
      body: JSON.stringify({
        action: input.action,
        projectId: input.projectId,
        parameters: input.parameters,
        expectedCursor: null,
        expectedVersion: input.grantVersion,
      }),
    });
  }
  async function archive(session: Session, operationId: string) {
    const response = await request(`/api/operations/${operationId}/download`, {
      headers: session.headers,
    });
    return new Uint8Array(await response.arrayBuffer());
  }
  return {
    request,
    login,
    configure,
    connect,
    action,
    archive,
    operation: async (response: Response) =>
      OperationEnvelope.parse(await response.json()).data,
    close: () => server.stop(true),
  };
}
