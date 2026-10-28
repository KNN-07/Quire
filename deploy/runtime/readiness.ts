import ky from "ky";
import { z } from "zod";

export async function readiness(role: string | undefined): Promise<void> {
  if (role === "repository") {
    const token = z.string().min(32).parse(process.env["QUIRE_REPOSITORY_TOKEN"]);
    const endpoint = z.url({ protocol: /^https$/ }).parse(process.env["QUIRE_REPOSITORY_URL"]);
    const response = await ky.post(new URL("/v1/readable", endpoint), {
      headers: { authorization: `Bearer ${token}` },
      json: { projectId: "00000000-0000-4000-8000-000000000000" },
      retry: 0, timeout: 4000, throwHttpErrors: false,
    });
    if (!response.ok) throw new ReadinessError(`repository ${response.status}`);
    z.object({ result: z.null() }).parse(await response.json());
    return;
  }
  const body: unknown = await ky.get("http://127.0.0.1:8080/api/health", {
    retry: 0, timeout: 4000,
  }).json();
  z.object({ data: z.object({ status: z.literal("ok"), database: z.literal("postgres") }) }).parse(body);
}
class ReadinessError extends Error {
  constructor(readonly reason: string) { super(`NOT_READY: ${reason}`); }
}
if (import.meta.main) await readiness(process.argv[2]);
