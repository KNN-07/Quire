import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

const authorization = z.object({
  client_id: z.literal("quire-app"), redirect_uri: z.literal("http://localhost:5173/api/connections/dropbox/callback"),
  response_type: z.literal("code"), scope: z.literal("files.metadata.read files.content.read files.content.write"),
  code_challenge_method: z.literal("S256"), code_challenge: z.string().length(43),
  token_access_type: z.literal("offline"), state: z.string().min(43),
});
export function oauthFixture() {
  const codes = new Map<string, z.infer<typeof authorization>>();
  const tokens = new Map<string, { readonly refresh: string; readonly expires: number }>();
  let now = Date.parse("2026-10-27T12:00:00.000Z");
  const issue = () => {
    const access = randomBytes(24).toString("hex"), refresh = randomBytes(24).toString("hex");
    tokens.set(access, { refresh, expires: now + 3600_000 });
    return Response.json({ access_token: access, refresh_token: refresh, token_type: "bearer", expires_in: 3600 });
  };
  return {
    tokens, advance(milliseconds: number) { now += milliseconds; },
    accepts(request: Request) {
      const token = tokens.get((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
      return token !== undefined && token.expires > now;
    },
    async handle(request: Request): Promise<Response | null> {
      const url = new URL(request.url);
      if (url.pathname === "/authorize") {
        const parsed = authorization.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
        const code = randomBytes(24).toString("hex"); codes.set(code, parsed.data);
        const target = new URL(parsed.data.redirect_uri);
        target.searchParams.set("code", code); target.searchParams.set("state", parsed.data.state);
        return Response.redirect(target, 303);
      }
      if (url.pathname === "/token") {
        const form = new URLSearchParams(await request.text());
        if (form.get("client_id") !== "quire-app" || form.get("client_secret") !== "dropbox-client-secret") {
          return Response.json({ error: "invalid_client" }, { status: 401 });
        }
        switch (form.get("grant_type") ?? "") {
          case "authorization_code": {
            const code = form.get("code") ?? "", saved = codes.get(code);
            codes.delete(code);
            if (!saved || saved.redirect_uri !== form.get("redirect_uri")
              || createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") !== saved.code_challenge) {
              return Response.json({ error: "invalid_grant" }, { status: 400 });
            }
            return issue();
          }
          case "refresh_token": {
            const previous = [...tokens].find(([, token]) => token.refresh === form.get("refresh_token"));
            if (!previous) return Response.json({ error: "invalid_grant" }, { status: 400 });
            tokens.delete(previous[0]); return issue();
          }
          default: return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
        }
      }
      if (url.pathname === "/2/auth/token/revoke") {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
        if (!tokens.delete(token)) return Response.json({ error_summary: "invalid_access_token/" }, { status: 401 });
        return Response.json(null);
      }
      return null;
    },
  };
}
