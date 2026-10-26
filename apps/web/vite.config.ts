import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const host = process.env["QUIRE_HOST"] ?? "127.0.0.1";
const proxyHost = host === "0.0.0.0" ? "127.0.0.1" : host;
const target = `http://${proxyHost.includes(":") ? `[${proxyHost}]` : proxyHost}:${process.env["QUIRE_PORT"] ?? "3001"}`;
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    host: process.env["QUIRE_WEB_HOST"] ?? "localhost", port: 5173, strictPort: true,
    proxy: Object.fromEntries(["/api", "/git", "/events", "/scim"].map((path) => [
      path, { target, ws: true },
    ])),
  },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
