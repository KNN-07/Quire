import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { ResponseOf } from "@quire/contracts";
import { AppHeader, Button, Icon, Spinner } from "../../ui";
import type { AdminPageProps } from "./api";
import { errorMessage } from "./api";
import { Architecture } from "./Architecture";
import { Overview } from "./Overview";
import { CompileQueue } from "./CompileQueue";
import { Identity } from "./Identity";
import { Users } from "./Users";
import { Workers } from "./Workers";
import { Provider } from "./Provider";
import { Backups } from "./Backups";
import { Updates } from "./Updates";
import { Support } from "./Support";
import { Environments } from "./Environments";
import { Audit } from "./Audit";
import { Templates } from "./Templates";
import { EditorMaintenance } from "./EditorMaintenance";
import { ProjectBenefits } from "./ProjectBenefits";
import "./admin.css";

export type { AdminPageProps } from "./api";
type Overview = ResponseOf<typeof endpoints.adminOverview>;
const navigation = [
  { id: "overview", label: "Overview", icon: "activity" }, { id: "identity", label: "Authentication", icon: "shield" },
  { id: "benefits", label: "Project benefits", icon: "zap" },
  { id: "users", label: "Users & groups", icon: "users" }, { id: "workers", label: "Compile workers", icon: "cpu" },
  { id: "tex", label: "TeX Live images", icon: "image" }, { id: "ai", label: "AI provider", icon: "sparkle" },
  { id: "templates", label: "Templates", icon: "template" }, { id: "storage", label: "Storage & backups", icon: "database" },
  { id: "updates", label: "Updates", icon: "refresh" }, { id: "support", label: "Support", icon: "lifebuoy" }, { id: "audit", label: "Audit log", icon: "list" },
  { id: "architecture", label: "Architecture", icon: "server" },
] as const;

export function AdminPage({ path, client, navigate }: AdminPageProps) {
  const requestedSection = new URL(path, window.location.origin).pathname.split("/")[2] || "overview";
  const section = requestedSection === "providers" ? "ai" : requestedSection;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [message, setMessage] = useState("");
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setOverview(null);
    setDenied(false);
    void client.call(endpoints.adminOverview, { params: {}, query: {}, body: undefined }, controller.signal).then(response => {
      if (controller.signal.aborted) return;
      if ("error" in response) {
        setDenied(["FORBIDDEN", "UNAUTHENTICATED", "DENIED", "UNAUTHORIZED", "OPERATOR_REQUIRED"].includes(response.error.code));
        setMessage(`${response.error.code}: ${response.error.message}`);
      } else { setOverview(response.data); setMessage(""); }
      setLoading(false);
    }).catch((error: unknown) => { if (!controller.signal.aborted) { setMessage(errorMessage(error)); setLoading(false); } });
    return () => controller.abort();
  }, [client, refresh]);
  useEffect(() => {
    document.title = `${navigation.find(item => item.id === section)?.label ?? "Administration"} · Quire`;
    document.getElementById("admin-content")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [section]);
  return <div className="admin-shell">
    <AppHeader className="admin-header" actions={<Button onClick={() => navigate("/projects")}><Icon name="arrowLeft" />Back to projects</Button>}>Server administration</AppHeader>
    <div className="admin-body">
      <nav className="admin-navigation" aria-label="Administration">
        {navigation.map(item => <a key={item.id} href={item.id === "overview" ? "/admin" : `/admin/${item.id}`}
          aria-current={section === item.id ? "page" : undefined}
          onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigate(event.currentTarget.pathname); } }}><Icon name={item.icon} />{item.label}</a>)}
      </nav>
      <label className="admin-mobile-navigation">Administration
        <select aria-label="Administration section" value={section}
          onChange={event => navigate(event.currentTarget.value === "overview" ? "/admin" : `/admin/${event.currentTarget.value}`)}>
          {navigation.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <main key={section} className="admin-main" id="admin-content">
        {loading ? <Spinner label="Checking operator access" /> : !overview
          ? <section className="admin-denied"><Icon name={denied ? "lock" : "warning"} size={28} /><h1>{denied ? "Operator access denied" : "Administration unavailable"}</h1>
            <p role="alert">{message}</p>
            <Button onClick={() => setRefresh(previous => previous + 1)}>Retry access check</Button></section>
          : <div className="admin-content">
            {section === "overview" ? <><Overview data={overview} refresh={() => setRefresh(previous => previous + 1)} navigate={navigate} /><CompileQueue client={client} navigate={navigate} /><EditorMaintenance client={client} /></>
              : section === "users" ? <Users client={client} />
              : section === "benefits" ? <ProjectBenefits client={client} />
              : section === "workers" ? <Workers client={client} />
                : section === "tex" ? <Environments client={client} navigate={navigate} />
                : section === "ai" ? <Provider client={client} />
                  : section === "storage" ? <Backups client={client} navigate={navigate} />
                    : section === "updates" ? <Updates client={client} navigate={navigate} />
                      : section === "support" ? <Support client={client} path={path} navigate={navigate} />
                        : section === "audit" ? <Audit client={client} navigate={navigate} />
                          : section === "templates" ? <Templates client={client} />
              : section === "identity" ? <Identity client={client} />
              : section === "architecture" ? <Architecture overview={overview} />
                : <><h1>Unknown administration section</h1><Button onClick={() => navigate("/admin")}>Open overview</Button></>}
          </div>}
      </main>
    </div>
  </div>;
}
