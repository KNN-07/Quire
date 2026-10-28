import { StorageError } from "./errors";

export type PreparedState = "prepared" | "activating" | "active" | "disposing" | "disposed" | "failed";

/** Process-local ownership only. The installation host authorizes activation. */
export class PreparedLifecycle<T> {
  private current: PreparedState = "prepared";
  private activation: Promise<T> | undefined;
  private disposal: Promise<void> | undefined;
  private released: Promise<void> | undefined;
  constructor(private readonly start: () => Promise<T>, private readonly release: () => Promise<void>) {}
  get state(): PreparedState { return this.current; }
  private cleanup(): Promise<void> {
    this.released ??= Promise.resolve().then(this.release);
    return this.released;
  }
  activate(): Promise<T> {
    if (this.disposal || this.current === "disposed") {
      return Promise.reject(new StorageError("RUNTIME_DISPOSED", "Activation cannot reopen a disposed runtime"));
    }
    if (!this.activation) {
      this.current = "activating";
      this.activation = Promise.resolve().then(async () => {
        try {
          if (this.disposal) throw new StorageError("RUNTIME_DISPOSED", "Disposal interrupted activation");
          const result = await this.start();
          if (this.disposal) throw new StorageError("RUNTIME_DISPOSED", "Disposal interrupted activation");
          this.current = "active";
          return result;
        } catch (error) {
          if (!this.disposal) this.current = "failed";
          try { await this.cleanup(); }
          catch (failure) {
            throw new AggregateError([error, failure], "Activation and cleanup failed", { cause: failure });
          }
          throw error;
        }
      });
    }
    return this.activation;
  }
  dispose(): Promise<void> {
    if (!this.disposal) {
      this.current = "disposing";
      this.disposal = (async () => {
        // A rejected activation already owns and reports its error; disposal still drains.
        if (this.activation) await this.activation.then(() => undefined, () => undefined);
        try { await this.cleanup(); this.current = "disposed"; }
        catch (error) { this.current = "failed"; throw error; }
      })();
    }
    return this.disposal;
  }
}
