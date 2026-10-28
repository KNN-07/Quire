import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const [root, cacheDir, target] = process.argv.slice(2);
if (!root || !cacheDir || !target) throw new TypeError("Expected root, cache directory and API target");
const http = createHttpServer();
/** @type {Set<import("node:net").Socket>} */
const sockets = new Set();
http.on("connection", socket => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});
const web = await createServer({
  configFile: false, root, plugins: [react()], cacheDir, logLevel: "error",
  server: {
    middlewareMode: { server: http }, hmr: { server: http },
    proxy: Object.fromEntries(["/api", "/git", "/events", "/scim"].map(path => [path, { target, ws: true }])),
  },
});
http.on("request", web.middlewares);
const listening = once(http, "listening");
http.listen(0, "127.0.0.1");
await listening;
const address = http.address();
if (!address || typeof address === "string") throw new TypeError("Expected TCP listener");
console.info(`QUIRE_EDITOR_WEB_READY=http://127.0.0.1:${address.port}`);
const stopped = new Promise(resolve => {
  process.once("SIGTERM", resolve);
  process.once("SIGINT", resolve);
});
await stopped;
const closed = once(http, "close");
http.close();
// closeAllConnections excludes upgraded proxy sockets, which this listener owns.
for (const socket of sockets) socket.destroy();
await web.close();
await closed;
