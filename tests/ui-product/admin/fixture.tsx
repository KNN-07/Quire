import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@quire/contracts";
import { AdminPage } from "../../../apps/web/src/features/admin";
import "../../../apps/web/src/styles/tokens.css";
import "../../../apps/web/src/styles/global.css";

const client = createClient("", { csrfToken: () => "fixture-csrf" });
function Fixture() {
  const [path, setPath] = useState("/admin");
  return <AdminPage path={path} client={client} navigate={setPath} onSessionChange={async () => {}} />;
}
const root = document.getElementById("root");
if (!root) throw new TypeError("Missing fixture root");
createRoot(root).render(<Fixture />);
