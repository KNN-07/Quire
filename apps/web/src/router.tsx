import { useEffect, useState } from "react";
import { createClient, endpoints } from "@quire/contracts";

export const webRoutes = [
  "/", "/projects", "/sign-in", "/sign-up", "/reset-password", "/pricing", "/self-hosting",
  "/settings/:tab", "/admin", "/admin/identity", "/admin/architecture", "/admin/:section",
  "/projects/:p/edit", "/projects/:p/git", "/projects/:p/agent", "/projects/:p/history",
  "/projects/:p/review", "/projects/:p/logs", "/projects/:p/pdf-diff",
] as const;
const client = createClient();
export function AppRouter() {
  const [health, setHealth] = useState("Checking API connection");
  useEffect(() => {
    const controller = new AbortController();
    void client.call(endpoints.health, { params: {}, query: {}, body: undefined }, controller.signal)
      .then((result) => {
        setHealth("data" in result ? `API connected (${result.data.runtime})` : result.error.message);
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setHealth(error instanceof Error ? error.message : "API unavailable");
      });
    return () => { controller.abort(); };
  }, []);
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "18px 24px", borderBottom: "1px solid #e6e8ed", display: "flex", gap: 24 }}>
        <a href="/" aria-label="Quire home"><strong>Quire</strong></a>
        <nav aria-label="Primary" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <a href="/projects">Projects</a><a href="/sign-in">Sign in</a><a href="/self-hosting">Self-hosting</a>
        </nav>
      </header>
      <main style={{ width: "min(960px, 100%)", margin: "0 auto", padding: "48px 24px", boxSizing: "border-box" }}>
        <h1>Quire workspace</h1>
        <p>A persistent foundation for LaTeX writing.</p>
        <p role="status">{health}</p>
        <section aria-labelledby="foundation-status">
          <h2 id="foundation-status">Foundation ready</h2>
          <p>Authentication, editing, collaboration and compilation are not implemented in this shell.</p>
          <p>Run <code>bun run seed</code> to create the local example. Feature routes return explicit errors until their service modules are registered.</p>
          <p>Current route: <code>{window.location.pathname}</code></p>
        </section>
      </main>
    </div>
  );
}
