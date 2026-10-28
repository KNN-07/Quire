import { AsyncLocalStorage } from "node:async_hooks";
import type { MutationAdmission } from "@quire/contracts";
import { ServiceError } from "./errors";

type Scope = { active: boolean; readonly children: Set<Promise<unknown>> };

/** A scope remains admitted through all registered children, including detached work. */
export class LocalMutationAdmission implements MutationAdmission {
  private readonly scope = new AsyncLocalStorage<Scope>();
  private readonly writers = new Set<Promise<unknown>>();
  private maintenance: Promise<void> | undefined;
  private closing = false;
  constructor(private readonly authority?: MutationAdmission) {}

  async close(): Promise<void> {
    if (this.scope.getStore()?.active) throw new ServiceError("ADMISSION_REENTRANT", 409, "Close outside source operations");
    this.closing = true;
    await this.maintenance;
    await Promise.allSettled([...this.writers]);
  }

  background<T>(work: () => Promise<T>): Promise<T> {
    return this.scope.exit(async () => {
      while (this.maintenance) await this.maintenance;
      if (this.closing) throw new ServiceError("DATABASE_CLOSED", 503, "Admission is closing");
      const result = this.authority ? this.authority.background(() => this.run(work)) : this.run(work);
      this.writers.add(result);
      try { return await result; } finally { this.writers.delete(result); }
    });
  }

  async writer<T>(work: () => Promise<T>): Promise<T> {
    const parent = this.scope.getStore();
    if (parent) {
      if (!parent.active) throw new ServiceError("ADMISSION_EXPIRED", 409, "The owning operation has finished");
      const result = Promise.resolve().then(work);
      parent.children.add(result);
      try { return await result; } finally { parent.children.delete(result); }
    }
    if (this.closing) throw new ServiceError("DATABASE_CLOSED", 503, "Admission is closing");
    if (this.maintenance) throw new ServiceError("BACKUP_MAINTENANCE", 503, "Source writes are paused for backup");
    const result = this.authority ? this.authority.writer(() => this.run(work)) : this.run(work);
    this.writers.add(result);
    try { return await result; } finally { this.writers.delete(result); }
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    const scope: Scope = { active: true, children: new Set() };
    try {
      return await this.scope.run(scope, work);
    } finally {
      while (scope.children.size) await Promise.allSettled([...scope.children]);
      scope.active = false;
    }
  }

  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.scope.getStore()) throw new ServiceError("BACKUP_REENTRANT", 409, "Backup cannot run inside writer admission");
    if (this.maintenance) throw new ServiceError("BACKUP_BUSY", 409, "Another backup owns admission");
    if (this.closing) throw new ServiceError("DATABASE_CLOSED", 503, "Admission is closing");
    const released = Promise.withResolvers<void>();
    this.maintenance = released.promise;
    try {
      await Promise.allSettled([...this.writers]);
      return await (this.authority ? this.authority.exclusive(() => this.run(work)) : this.run(work));
    } finally { this.maintenance = undefined; released.resolve(); }
  }
}
