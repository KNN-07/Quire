import { UpdateError } from "../../../services/operations/updates";

export async function rejection(action: Promise<unknown>): Promise<Error> {
  try { await action; }
  catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new UpdateError("EXPECTED_REJECTION");
}
