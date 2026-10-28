import { z } from "zod";
import ky from "ky";
import { repositoryMain } from "../../apps/server/src/repository-main";

/** TLS termination stays in the singleton repository role; keys never mount in APIs. */
if (import.meta.main) {
  const tls = z.object({
    cert: z.string().min(1), key: z.string().min(1),
    port: z.coerce.number().int().min(1).max(65535).default(3443),
  }).parse({
    cert: process.env["QUIRE_REPOSITORY_TLS_CERT"], key: process.env["QUIRE_REPOSITORY_TLS_KEY"],
    port: process.env["QUIRE_REPOSITORY_TLS_PORT"],
  });
  const listener = Bun.serve({
    hostname: "0.0.0.0", port: tls.port, maxRequestBodySize: 73 * 1024 * 1024,
    tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) },
    async fetch(request) {
      const url = new URL(request.url);
      const forwarded = new Request(`http://127.0.0.1:3002${url.pathname}${url.search}`, request);
      return ky(forwarded, { retry: 0, timeout: 60_000, throwHttpErrors: false, redirect: "error" });
    },
  });
  console.info("repository.tls.listening", { port: listener.port });
  try {
    await repositoryMain({ ...process.env, QUIRE_REPOSITORY_HOST: "127.0.0.1", QUIRE_REPOSITORY_PORT: "3002" });
  } finally { await listener.stop(true); }
}
