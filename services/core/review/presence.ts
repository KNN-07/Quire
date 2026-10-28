import type { RealtimeClientMessage } from "@quire/contracts";

type Presence = Extract<RealtimeClientMessage, { readonly type: "presence" }>;
type Schedule = (work: () => void, delay: number) => () => void;
const schedule: Schedule = (work, delay) => {
  const timer = setTimeout(work, delay);
  return () => clearTimeout(timer);
};

/** Retain the trailing cursor while throttling or a previous broadcast is in flight. */
export class PresenceQueue {
  private pending: Presence | undefined;
  private cancel: (() => void) | undefined;
  private last = -Infinity;
  private sending = false;
  private closed = false;
  constructor(
    private readonly emit: (message: Presence) => Promise<void>,
    private readonly now = () => performance.now(),
    private readonly later: Schedule = schedule,
  ) {}
  push(message: Presence): void {
    if (this.closed) return;
    this.pending = message;
    this.flush();
  }
  private flush(): void {
    if (this.closed || this.sending || this.cancel || !this.pending) return;
    const delay = 50 - (this.now() - this.last);
    if (delay > 0) {
      this.cancel = this.later(() => { this.cancel = undefined; this.flush(); }, delay);
      return;
    }
    const message = this.pending;
    this.pending = undefined;
    this.sending = true;
    this.last = this.now();
    void this.emit(message).finally(() => { this.sending = false; this.flush(); });
  }
  close(): void {
    this.closed = true;
    this.cancel?.();
    this.cancel = undefined;
    this.pending = undefined;
  }
}
