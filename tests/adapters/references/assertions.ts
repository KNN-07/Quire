import { ServiceError } from "@quire/runtime";

export async function rejection(pending: Promise<unknown>): Promise<ServiceError> {
  try { await pending; }
  catch (error) { if (error instanceof ServiceError) return error; throw error; }
  throw new TypeError("Expected a rejected service operation");
}
