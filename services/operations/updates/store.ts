import type { Clock, Id, Operation } from "@quire/contracts";
import type { ControlStore } from "../installation/control-store";
import type { ControlReceipt, ReservedUpdateCommand, UpdateOperationQuery } from "../installation/model";
import type { SignedRelease } from "./model";
import { UpdateError } from "./model";

/** Controller-only facade. There is deliberately no application SQL handle. */
export class UpdateStore {
  constructor(readonly control: ControlStore, readonly clock: Clock) {}
  async operation(id: Id): Promise<Operation> {
    const row = this.control.get(id);
    if (row === null) throw new UpdateError("UPDATE_NOT_FOUND");
    return row.operation;
  }
  floor() { return this.control.state().floor; }
  existing(request: ReservedUpdateCommand) { return this.control.existing(request)?.operation ?? null; }
  enqueue(request: ReservedUpdateCommand, release: SignedRelease) {
    return this.control.accept(request, release, this.clock.now()).operation;
  }
  due(): ControlReceipt | null { return this.control.claimDue(this.clock.now()); }
  list(query: UpdateOperationQuery) { return this.control.list(query); }
}
