import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@quire/contracts";
import { ProjectsPage } from "../../../apps/web/src/features/projects";
import "../../../apps/web/src/styles/global.css";

const client = createClient("", { csrfToken: () => "projects-fixture-csrf" });
function Preview() {
  const [path, setPath] = useState(`/projects${window.location.search}`);
  return <><output hidden aria-label="Navigation destination">{path}</output><ProjectsPage path={path} client={client} navigate={setPath} onSessionChange={() => Promise.resolve()} /></>;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
