import { z } from "zod";
import { endpoint, request, EmptySchema, ListQuerySchema } from "./endpoint";
import { CountSchema } from "./primitives";
import type { Lane, Method, Transport } from "./endpoint";

type RouteSchemas<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType, O extends z.ZodType> = {
  readonly params: P; readonly query: Q; readonly body: B; readonly output: O;
  readonly transport?: Transport; readonly idempotent?: boolean;
  readonly ifMatch?: boolean; readonly successStatus?: number;
};
export function routesFor(lane: Lane) {
  return function define<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType, O extends z.ZodType>(
    method: Method, path: string, schemas: RouteSchemas<P, Q, B, O>,
  ) {
    return endpoint({ method, path, lane }, {
      input: request(schemas.params, schemas.query, schemas.body), output: schemas.output,
    }, {
      transport: schemas.transport ?? "json", idempotent: schemas.idempotent ?? false,
      ifMatch: schemas.ifMatch ?? false, successStatus: schemas.successStatus ?? 200,
    });
  };
}
export const none = EmptySchema;
export const noBody = z.undefined();
export const list = ListQuerySchema;
export const version = { expectedVersion: CountSchema } as const;
export const key = { idempotent: true } as const;
