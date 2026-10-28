import type { ModuleContext } from "@quire/runtime";
import { registerDiagnostics } from "./diagnostics";
import { registerSiem, dispatchSiem } from "./siem";
import { registerInquiries } from "./inquiries";
import type { InquiryOutbox } from "./inquiries";

export { migrations } from "./migrations";
export { dispatchSiem } from "./siem";
export { diagnosticBytes, bundleContents, bundleOmissions } from "./diagnostics";
export { toolProbes, compilerProbe, portProbe, runtimeProbes, providerConfiguration } from "./probes";
export type { SupportInquiry, InquiryOutbox } from "./inquiries";

export function register(context: ModuleContext, options: { readonly inquiries?: InquiryOutbox } = {}): void {
  registerDiagnostics(context);
  registerSiem(context);
  registerInquiries(context, options.inquiries);
}

type Runner = {
  timer: ReturnType<typeof setTimeout> | null; pending: Promise<void>; stopped: boolean; failure: Error | null;
};
const runners = new WeakMap<object, Runner>();

/** Process owner starts after registering modules and drains before closing adapters. */
export function startSupport(context: Omit<ModuleContext, "routes">): void {
  if (runners.has(context.services)) return;
  const runner: Runner = { timer: null, pending: Promise.resolve(), stopped: false, failure: null };
  runners.set(context.services, runner);
  const schedule = () => {
    if (!runner.stopped) {
      runner.timer = setTimeout(tick, 1000);
      runner.timer.unref();
    }
  };
  const tick = () => {
    runner.pending = context.admission.background(() => dispatchSiem(context)).then(() => {
      runner.failure = null;
      schedule();
    }, error => {
      if (!(error instanceof Error)) throw error;
      runner.failure = error;
      console.warn("support.siem.retry", { code: "SIEM_STORAGE_UNAVAILABLE" });
      schedule();
    });
  };
  tick();
}

export async function stopSupport(context: Pick<ModuleContext, "services">): Promise<void> {
  const runner = runners.get(context.services);
  if (!runner) return;
  runner.stopped = true;
  if (runner.timer) clearTimeout(runner.timer);
  await runner.pending;
  runners.delete(context.services);
  if (runner.failure) throw runner.failure;
}
