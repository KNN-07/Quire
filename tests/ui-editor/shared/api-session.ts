import ky from "ky";
import { endpoints, resultSchema } from "@quire/contracts";
import { EditorApiError, editorValue } from "../../../apps/web/src/features/editor/shared";
import type { EditorApplication } from "./application";

/** Server-issued cookie and CSRF from actual login, not a database session shortcut. */
export async function authenticateApi(app: EditorApplication, email = "kien@quire.local") {
  const response = await ky.post(new URL(endpoints.authLogin.path, app.url), {
    json: { email, password: app.password }, headers: { origin: app.url.origin },
    timeout: 30_000, retry: 0, throwHttpErrors: false,
  });
  const user = editorValue(resultSchema(endpoints.authLogin.output).parse(await response.json()));
  const cookieHeader = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookieHeader) throw new EditorApiError("SESSION_COOKIE_MISSING", "Real login did not set a session cookie");
  const separator = cookieHeader.indexOf("=");
  const cookie = {
    name: cookieHeader.slice(0, separator), value: cookieHeader.slice(separator + 1),
    url: app.url.origin, httpOnly: true, sameSite: "Lax" as const,
  };
  const http = ky.create({
    prefixUrl: app.url.origin, headers: { cookie: cookieHeader, origin: app.url.origin },
    timeout: 30_000, retry: 0, throwHttpErrors: false,
  });
  const me = await http.get(endpoints.me.path.slice(1));
  const session = editorValue(resultSchema(endpoints.me.output).parse(await me.json()));
  return { user, cookie, session, http: http.extend({ headers: { "x-csrf-token": session.csrfToken } }) };
}
