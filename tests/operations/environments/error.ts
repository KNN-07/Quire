import { ServiceError } from "@quire/runtime";

export async function rejectionCode(action: Promise<unknown>): Promise<string> {
  try { await action; }
  catch(error) {
    if (error instanceof ServiceError) return error.code;
    throw error;
  }
  throw new TypeError("Expected a rejected service operation");
}
