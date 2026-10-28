import { useCallback, useEffect, useState } from "react";
import { AccountPage } from "./features/account";
import { ProjectsPage } from "./features/projects";
import { AdminPage } from "./features/admin";
import { MarketingPage } from "./features/marketing";
import { EditorPage } from "./features/editor";
import { Button, Spinner } from "./ui";
import { createSession } from "./session";
import type { SessionSnapshot } from "./session";

export const webRoutes = [
  "/", "/projects", "/sign-in", "/sign-up", "/verify-email", "/reset-password", "/pricing", "/self-hosting",
  "/institutions", "/institutions/:slug", "/terms", "/privacy", "/security",
  "/settings/:tab", "/admin", "/admin/identity", "/admin/architecture", "/admin/:section",
  "/projects/:p/edit", "/projects/:p/git", "/projects/:p/agent", "/projects/:p/history",
  "/projects/:p/review", "/projects/:p/logs", "/projects/:p/pdf-diff",
] as const;

const currentPath = () => location.pathname + location.search + location.hash;

export function AppRouter() {
  const [session] = useState(() => createSession());
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [path, setPath] = useState(currentPath);
  const pathname = new URL(path, location.origin).pathname;
  const navigate = useCallback((target: string) => {
    const url = new URL(target, location.origin);
    if (url.origin !== location.origin) { location.assign(url); return; }
    history.pushState(null, "", url);
    setPath(currentPath());
    window.scrollTo({ top: 0 });
  }, []);
  const onSessionChange = useCallback(async () => {
    setSnapshot(await session.refresh());
    setError("");
  }, [session]);
  useEffect(() => {
    const controller = new AbortController();
    void session.refresh(controller.signal).then(value => {
      if (!controller.signal.aborted) { setSnapshot(value); setReady(true); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "Session unavailable"); setReady(true); }
    });
    return () => controller.abort();
  }, [session]);
  useEffect(() => {
    const update = () => setPath(currentPath());
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => { window.removeEventListener("popstate", update); window.removeEventListener("hashchange", update); };
  }, []);
  useEffect(() => {
    const theme = snapshot?.preferences.theme ?? "system";
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset["theme"] = theme;
    document.documentElement.lang = snapshot?.user.interfaceLanguage ?? "en";
  }, [snapshot]);
  const props = {
    path: pathname === "/settings/connections" ? path.replace("/settings/connections", "/settings/git") : path,
    client: session.client, navigate, onSessionChange,
  };
  const account = ["/sign-in", "/sign-up", "/verify-email", "/reset-password"].includes(pathname) || pathname === "/settings" || pathname.startsWith("/settings/");
  const marketing = ["/", "/pricing", "/self-hosting", "/institutions", "/terms", "/privacy", "/security"].includes(pathname) || pathname.startsWith("/institutions/");
  if (marketing) return <MarketingPage {...props} />;
  if (!ready) return <main><Spinner label="Loading session" /></main>;
  if (error) return <main><h1>Session unavailable</h1><p role="alert">{error}</p><Button onClick={() => { void onSessionChange().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Session unavailable")); }}>Retry session</Button></main>;
  if (account) return <AccountPage {...props} />;
  if (pathname === "/projects") return <ProjectsPage {...props} />;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return <AdminPage {...props} />;
  if (/^\/projects\/[^/]+\/(edit|git|agent|history|review|logs|pdf-diff)$/.test(pathname)) {
    return <EditorPage {...props} />;
  }
  return <main><h1>Page not found</h1><Button onClick={() => navigate("/")}>Go home</Button></main>;
}
