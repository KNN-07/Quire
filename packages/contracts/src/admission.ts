/** Whole source-storage operations, including their asynchronous cleanup. */
export interface MutationAdmission {
  writer<T>(work: () => Promise<T>): Promise<T>;
  /** A new scheduled operation, independent of its triggering request, waits for admission. */
  background<T>(work: () => Promise<T>): Promise<T>;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
}
