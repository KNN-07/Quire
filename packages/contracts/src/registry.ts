import { z } from "zod";
import { endpoint, noInput } from "./endpoint";
import type { Endpoint } from "./endpoint";
import { InstantSchema } from "./primitives";
import { accountEndpoints } from "./routes-accounts";
import { coreEndpoints } from "./routes-core";
import { compilerEndpoints } from "./routes-compiler";
import { adapterEndpoints } from "./routes-adapters";
import { operationEndpoints } from "./routes-operations";
import { transportEndpoints } from "./routes-transports";

export const HealthSchema = z.strictObject({
  status: z.literal("ok"), runtime: z.string(), database: z.enum(["sqlite", "postgres"]), at: InstantSchema,
});
export const endpoints = {
  health: endpoint({ method: "GET", path: "/api/health", lane: "F" }, { input: noInput, output: HealthSchema }),
  ...accountEndpoints, ...coreEndpoints, ...compilerEndpoints,
  ...adapterEndpoints, ...operationEndpoints, ...transportEndpoints,
} as const;
export type EndpointName = keyof typeof endpoints;
export const endpointRegistry: readonly Endpoint[] = Object.freeze(Object.values(endpoints));
