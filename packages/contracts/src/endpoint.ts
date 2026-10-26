import { z } from "zod";
import { CountSchema, IdSchema, BranchSchema } from "./primitives";

export const EmptySchema = z.strictObject({});
export const ListQuerySchema = z.strictObject({
  cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const BranchQuerySchema = ListQuerySchema.extend({ branch: BranchSchema });
export const ExpectedVersionSchema = z.strictObject({ expectedVersion: CountSchema });
export const IdParamsSchema = z.strictObject({ id: IdSchema });
export const ProjectParamsSchema = z.strictObject({ p: IdSchema });
export const FileParamsSchema = ProjectParamsSchema.extend({ f: IdSchema });
export const ProjectIdParamsSchema = ProjectParamsSchema.extend({ id: IdSchema });
export const MutationHeadersSchema = z.object({
  "idempotency-key": z.string().min(1).max(255).optional(),
  "if-match": z.string().min(1).optional(),
});
export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type Transport = "json" | "bytes" | "multipart" | "sse" | "websocket";
export type Lane = "F" | "C" | "K" | "A" | "X" | "O";
export type Endpoint<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
  readonly method: Method; readonly path: string; readonly lane: Lane;
  readonly input: I; readonly output: O; readonly transport: Transport;
  readonly idempotent: boolean; readonly ifMatch: boolean; readonly successStatus: number;
};
export function endpoint<I extends z.ZodType, O extends z.ZodType>(
  route: { readonly method: Method; readonly path: string; readonly lane: Lane },
  schemas: { readonly input: I; readonly output: O },
  options: {
    readonly transport?: Transport; readonly idempotent?: boolean;
    readonly ifMatch?: boolean; readonly successStatus?: number;
  } = {},
): Endpoint<I, O> {
  return { ...route, ...schemas, transport: options.transport ?? "json",
    idempotent: options.idempotent ?? false, ifMatch: options.ifMatch ?? false,
    successStatus: options.successStatus ?? 200 };
}
export function request<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType>(
  params: P, query: Q, body: B,
) {
  return z.strictObject({ params, query, body, headers: MutationHeadersSchema.default({}) });
}
export const noInput = request(EmptySchema, EmptySchema, z.undefined());
export const BytesSchema = z.instanceof(Uint8Array);
export type RequestOf<E extends Endpoint> = z.input<E["input"]>;
export type ResponseOf<E extends Endpoint> = z.output<E["output"]>;
