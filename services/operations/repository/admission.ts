import { LocalMutationAdmission, ServiceError } from "@quire/runtime";
import type { AdmissionTicket, PostgresMutationAdmission } from "../storage/postgres";

type Owner = {
  readonly ticket: AdmissionTicket; readonly release: () => void; readonly held: Promise<void>;
  readonly pending: Set<Promise<unknown>>;
};

/** Drains actual Git child exit after the API PostgreSQL sessions are excluded. */
export class RepositoryAdmission {
  private readonly gate = new LocalMutationAdmission();
  private owner: Owner | undefined;
  constructor(private readonly postgres: PostgresMutationAdmission) {}

  private async expire(): Promise<void> {
    const owner = this.owner;
    if (owner && !(await this.postgres.valid(owner.ticket))) {
      await this.release(owner);
    }
  }

  private async release(owner: Owner): Promise<void> {
    while (owner.pending.size) await Promise.allSettled([...owner.pending]);
    owner.release();
    await owner.held;
    if (this.owner === owner) this.owner = undefined;
  }

  async begin(ticket: AdmissionTicket): Promise<void> {
    await this.expire();
    if (!ticket.exclusive || !(await this.postgres.valid(ticket))) {
      throw new ServiceError("ADMISSION_EXPIRED", 409, "A live PostgreSQL backup owner is required");
    }
    if (this.owner) throw new ServiceError("BACKUP_BUSY", 409, "Repository backup admission is already held");
    const ready = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const held = this.gate.exclusive(async () => { ready.resolve(); await released.promise; });
    this.owner = { ticket, release: () => released.resolve(), held, pending: new Set() };
    void held.catch((error: unknown) => ready.reject(error));
    await ready.promise;
  }

  async end(ticket: AdmissionTicket): Promise<void> {
    const owner = this.owner;
    if (!owner || owner.ticket.name !== ticket.name) {
      throw new ServiceError("ADMISSION_EXPIRED", 409, "Only the repository backup owner can release admission");
    }
    await this.release(owner);
  }

  async run<T>(ticket: AdmissionTicket | undefined, work: () => Promise<T>): Promise<T> {
    await this.expire();
    const owner = this.owner;
    if (ticket?.exclusive && owner?.ticket.name === ticket.name) {
      const result = this.postgres.borrow(ticket, work);
      owner.pending.add(result);
      try { return await result; } finally { owner.pending.delete(result); }
    }
    return this.gate.writer(() => ticket ? this.postgres.borrow(ticket, work) : this.postgres.writer(work));
  }

  async close(): Promise<void> {
    if (this.owner) await this.release(this.owner);
  }
}
