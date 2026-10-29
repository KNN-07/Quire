import { useEffect, useState } from "react";
import { z } from "zod";

/** The same origin check used by password sign-in, shared with signup. */
export function accountReturnPath(requested: string | null, origin: string): string | null {
  const destination = requested && URL.canParse(requested, origin) ? new URL(requested, origin) : null;
  return destination?.origin === origin ? destination.pathname + destination.search + destination.hash : null;
}
export function billingReturnPath(requested: string | null, origin: string): string | null {
  const safe = accountReturnPath(requested, origin);
  if (!safe) return null;
  const destination = new URL(safe, origin);
  const plan = destination.searchParams.get("plan");
  const period = destination.searchParams.get("period");
  if (destination.pathname !== "/settings/billing" || !plan || !["month", "year"].includes(period ?? "")
    || destination.searchParams.getAll("plan").length !== 1 || destination.searchParams.getAll("period").length !== 1) return null;
  // Only pricing's public selection is durable; no arbitrary query, token or credential is copied.
  return `/settings/billing?${new URLSearchParams({ plan, period: period ?? "" })}`;
}
const key = "quire.onboarding.billing-return.v1";
const pendingSchema = z.strictObject({ version: z.literal(1), path: z.string(), expiresAt: z.number() });
function pendingBillingReturn(): string | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    localStorage.removeItem(key); return null;
  }
  const pending = pendingSchema.safeParse(value);
  if (!pending.success || pending.data.expiresAt <= Date.now()) { localStorage.removeItem(key); return null; }
  return billingReturnPath(pending.data.path, location.origin);
}
export function clearBillingReturn(): void { localStorage.removeItem(key); }
export function useAuthReturn(path: string, resume = true): string | null {
  const params = new URL(path, location.origin).searchParams;
  const explicit = params.has("returnTo");
  const [pending] = useState(pendingBillingReturn);
  const requested = explicit ? accountReturnPath(params.get("returnTo"), location.origin) : resume ? pending : null;
  const destination = billingReturnPath(requested, location.origin) ?? requested;
  useEffect(() => {
    if (!explicit) return;
    const billing = billingReturnPath(destination, location.origin);
    if (billing) localStorage.setItem(key, JSON.stringify({ version: 1, path: billing, expiresAt: Date.now() + 86_400_000 }));
    else clearBillingReturn();
  }, [explicit, destination]);
  return destination;
}
export function authPath(path: string, returnTo: string | null): string {
  const destination = new URL(path, location.origin);
  if (returnTo) destination.searchParams.set("returnTo", returnTo);
  return destination.pathname + destination.search;
}
