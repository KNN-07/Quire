export type ServiceFailure = {
  readonly message: string; readonly details?: Readonly<Record<string, unknown>>;
};
export class ServiceError extends Error {
  readonly details: Readonly<Record<string, unknown>> | undefined;
  constructor(
    readonly code: string,
    readonly status: number,
    failure: string | ServiceFailure,
  ) {
    super(typeof failure === "string" ? failure : failure.message);
    this.name = "ServiceError";
    this.details = typeof failure === "string" ? undefined : failure.details;
  }
}
export class StorageError extends Error {
  constructor(readonly code: string, readonly resource: string) {
    super(`${code}: ${resource}`); this.name = "StorageError";
  }
}
