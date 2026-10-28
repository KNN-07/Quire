import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

const AuthorizationSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.literal("publisher-fixture-client"),
  redirect_uri: z.url(),
  scope: z.literal("submissions:read submissions:write"),
  state: z.string().min(43),
  code_challenge_method: z.literal("S256"),
  code_challenge: z.string().length(43),
});
const TokenSchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string(),
  redirect_uri: z.url(),
  code_verifier: z.string().min(43),
});
type Authorization = z.infer<typeof AuthorizationSchema>;
type Submission = {
  readonly archiveSha256: string;
  readonly receipt: string;
  status: string;
};

export function publisherProvider() {
  const codes = new Map<string, Authorization>();
  const tokens = new Set<string>();
  const submissions = new Map<string, Submission>();
  const idempotency = new Map<string, string>();
  const observed: string[] = [];
  let submitRequests = 0;
  let statusRequests = 0;
  let failNextSubmit = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      observed.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/oauth/authorize") {
        const parsed = AuthorizationSchema.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
        const code = randomBytes(24).toString("base64url");
        codes.set(code, parsed.data);
        const callback = new URL(parsed.data.redirect_uri);
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", parsed.data.state);
        return Response.redirect(callback, 303);
      }
      if (url.pathname === "/oauth/token") {
        const form = Object.fromEntries(new URLSearchParams(await request.text()));
        if (
          form["client_id"] !== "publisher-fixture-client" ||
          form["client_secret"] !== "publisher-fixture-secret"
        ) {
          return Response.json({ error: "invalid_client" }, { status: 401 });
        }
        const parsed = TokenSchema.safeParse(form);
        const authorization = parsed.success ? codes.get(parsed.data.code) : undefined;
        if (
          !parsed.success ||
          !authorization ||
          authorization.redirect_uri !== parsed.data.redirect_uri ||
          createHash("sha256").update(parsed.data.code_verifier).digest("base64url") !==
            authorization.code_challenge
        ) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        codes.delete(parsed.data.code);
        const access = randomBytes(32).toString("base64url");
        tokens.add(access);
        return Response.json({
          access_token: access,
          token_type: "Bearer",
          scope: "submissions:read submissions:write",
        });
      }
      const access = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      if (url.pathname === "/oauth/revoke") {
        const form = Object.fromEntries(new URLSearchParams(await request.text()));
        const token = form["token"];
        if (token) tokens.delete(token);
        return new Response(null, { status: 200 });
      }
      if (!tokens.has(access)) return Response.json({ error: "invalid_token" }, { status: 401 });
      if (url.pathname === "/api/me") return Response.json({ account: "publisher-fixture" });
      if (url.pathname === "/api/submissions" && request.method === "POST") {
        submitRequests++;
        if (failNextSubmit) {
          failNextSubmit = false;
          return Response.json({ error: "destination_unavailable" }, { status: 503 });
        }
        const key = request.headers.get("idempotency-key");
        const expectedDigest = request.headers.get("x-quire-archive-sha256");
        const archive = new Uint8Array(await request.arrayBuffer());
        const actualDigest = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
        if (!key || !expectedDigest || expectedDigest !== actualDigest) {
          return Response.json({ error: "invalid_archive" }, { status: 422 });
        }
        const priorId = idempotency.get(key);
        if (priorId) {
          const prior = submissions.get(priorId);
          if (!prior) return Response.json({ error: "receipt_missing" }, { status: 500 });
          return Response.json({
            submission_id: priorId,
            status: prior.status,
            receipt: prior.receipt,
          });
        }
        const id = `publisher-${submissions.size + 1}`;
        const receipt = `receipt-${createHash("sha256").update(`${id}:${actualDigest}`).digest("hex")}`;
        submissions.set(id, { archiveSha256: actualDigest, receipt, status: "received" });
        idempotency.set(key, id);
        return Response.json({ submission_id: id, status: "received", receipt });
      }
      const submissionId = url.pathname.startsWith("/api/submissions/")
        ? decodeURIComponent(url.pathname.slice("/api/submissions/".length))
        : null;
      if (submissionId && request.method === "GET") {
        statusRequests++;
        const submission = submissions.get(submissionId);
        if (!submission) return Response.json({ error: "not_found" }, { status: 404 });
        return Response.json({
          submission_id: submissionId,
          status: submission.status,
          receipt: submission.receipt,
        });
      }
      return new Response(null, { status: 404 });
    },
  });
  return {
    origin: server.url.origin,
    observed,
    get submitRequests() {
      return submitRequests;
    },
    get statusRequests() {
      return statusRequests;
    },
    failSubmission() {
      failNextSubmit = true;
    },
    accept(submissionId: string) {
      const submission = submissions.get(submissionId);
      if (!submission) throw new TypeError("Publisher fixture submission not found");
      submission.status = "accepted";
    },
    async [Symbol.asyncDispose]() {
      await server.stop(true);
    },
  };
}
export type PublisherProvider = ReturnType<typeof publisherProvider>;
