import { createRoot } from "react-dom/client";
import { createClient } from "@quire/contracts";
import { MarketingPage } from "../../../apps/web/src/features/marketing";
import "../../../apps/web/src/styles/tokens.css";
import "../../../apps/web/src/styles/global.css";

const client = createClient();
const root = document.getElementById("root");
if (root) createRoot(root).render(<MarketingPage
  path={location.pathname}
  client={client}
  navigate={path => location.assign(path)}
  onSessionChange={() => Promise.resolve()}
/>);
