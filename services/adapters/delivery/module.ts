import { z } from "zod";
import type { ServiceModule } from "@quire/runtime";
import { MailDelivery } from "./delivery";
import type { DeliverySummary, MailDeliveryOptions } from "./delivery";
import { migrations } from "./migrations";

export class DeliveryScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<DeliverySummary> | undefined;
  private failure: { readonly error: unknown } | undefined;

  constructor(
    private readonly delivery: MailDelivery,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.wake(), z.number().int().min(1_000).parse(this.intervalMs));
    this.timer.unref();
    this.wake();
  }

  wake(): void {
    if (this.active || this.failure) return;
    const active = this.delivery.drain();
    this.active = active;
    const settled = () => {
      if (this.active === active) this.active = undefined;
    };
    void active.then(settled, error => {
      this.failure = { error };
      if (this.timer !== undefined) clearInterval(this.timer);
      this.timer = undefined;
      settled();
    });
  }

  async close(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    try { await this.active; }
    finally { await this.delivery.close(); }
    if (this.failure) throw this.failure.error;
  }
}

export function createDeliveryModule(options: MailDeliveryOptions = {}): {
  readonly module: ServiceModule;
  readonly drain: () => Promise<DeliverySummary>;
  readonly schedule: (intervalMs: number) => DeliveryScheduler;
  readonly close: () => Promise<void>;
} {
  let delivery: MailDelivery | undefined;
  const required = (): MailDelivery => {
    if (!delivery) throw new TypeError("Delivery module is not registered");
    return delivery;
  };
  return {
    module: {
      id: "062-x-mail-delivery",
      lane: "X",
      order: 62,
      migrations,
      register(context) {
        delivery = new MailDelivery(context, options);
      },
    },
    drain: () => required().drain(),
    schedule(intervalMs) {
      const scheduler = new DeliveryScheduler(required(), intervalMs);
      scheduler.start();
      return scheduler;
    },
    close: async () => delivery?.close(),
  };
}
