import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRouter } from "./router";
import "./styles/tokens.css";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new TypeError("Missing #root");
createRoot(root).render(<StrictMode><AppRouter /></StrictMode>);
