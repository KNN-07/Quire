import { createServer } from "node:http";
import { once } from "node:events";

export function lifecycleGate<T>() {
  const pending = Promise.withResolvers<T>();
  return {
    resolve: pending.resolve,
    async wait(): Promise<T> {
      const deadline = AbortSignal.timeout(3000);
      const timeout = Promise.withResolvers<never>();
      const abort = () => timeout.reject(new TypeError("Lifecycle event did not arrive"));
      deadline.addEventListener("abort", abort, { once: true });
      try { return await Promise.race([pending.promise, timeout.promise]); }
      finally { deadline.removeEventListener("abort", abort); }
    },
  };
}

export async function heldReferenceProvider() {
  const entered = lifecycleGate<void>();
  const disconnected = lifecycleGate<void>();
  const release = lifecycleGate<void>();
  const server = createServer((_request, response) => {
    response.once("close", () => disconnected.resolve());
    entered.resolve();
    void release.wait().then(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: { items: [{
        DOI: "10.1234/lifecycle", title: ["Lifecycle paper"], author: [],
        issued: { "date-parts": [[2026]] }, URL: "https://doi.org/10.1234/lifecycle",
      }], "total-results": 1 } }));
    }, error => {
      response.destroy(error instanceof Error ? error : new TypeError("Provider release failed"));
    });
  });
  const listening = once(server, "listening", { signal: AbortSignal.timeout(3000) });
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") throw new TypeError("TCP provider required");
  return {
    origin: `http://127.0.0.1:${address.port}`, entered, disconnected, release,
    async [Symbol.asyncDispose]() {
      release.resolve();
      const closed = once(server, "close", { signal: AbortSignal.timeout(3000) });
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
