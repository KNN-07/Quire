import { forwardRef, useEffect, useId, useRef } from "react";
import type { DialogHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { IconButton } from "./controls";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface BrandMarkProps extends HTMLAttributes<HTMLSpanElement> { wordmark?: boolean }
export function BrandMark({ wordmark = true, className = "", ...props }: BrandMarkProps) {
  return <span {...props} className={`q-brand ${className}`}><span className="q-brand__mark" aria-hidden="true">q</span>{wordmark ? <span>Quire</span> : <span className="q-sr-only">Quire</span>}</span>;
}

export interface AppHeaderProps extends HTMLAttributes<HTMLElement> { brand?: ReactNode; actions?: ReactNode }
export const AppHeader = forwardRef<HTMLElement, AppHeaderProps>(function AppHeader(
  { brand = <BrandMark />, children, actions, className = "", ...props }, ref,
) {
  return <header {...props} ref={ref} className={`q-header ${className}`}>{brand}<div className="q-header__content">{children}</div>{actions && <div className="q-header__actions">{actions}</div>}</header>;
});

export interface ModalProps extends Omit<DialogHTMLAttributes<HTMLDialogElement>, "title" | "onClose" | "open"> {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: "regular" | "wide";
  closeLabel?: string;
}
/** Native modal dialogs make siblings inert and contain keyboard focus. */
export function Modal({ open, onClose, title, description, children, footer, size = "regular", closeLabel = "Close dialog", className = "", ...props }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!node || !open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = "hidden";
    return () => { node.close(); document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
  }, [open]);
  return <dialog {...props} ref={dialog} role="dialog" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} className={`q-modal q-modal--${size} ${className}`}
    onKeyDown={event => {
      props.onKeyDown?.(event);
      if (event.defaultPrevented || event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex],summary,[contenteditable="true"]')]
        .filter(node => node.tabIndex >= 0 && !node.matches(":disabled,[inert]") && node.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onCancel={event => { props.onCancel?.(event); if (!event.defaultPrevented) { event.preventDefault(); onClose(); } }}>
    <div className="q-modal__header"><h2 id={`${id}-title`} className="q-modal__title">{title}</h2><IconButton label={closeLabel} icon="close" variant="ghost" onClick={onClose} /></div>
    <div className="q-modal__body">{description && <p className="q-modal__description" id={`${id}-description`}>{description}</p>}{children}</div>
    {footer && <div className="q-modal__footer">{footer}</div>}
  </dialog>;
}

const okStates = new Set(["ready", "healthy", "configured", "enabled", "succeeded", "active", "connected", "verified", "passed"]);
const warnStates = new Set(["running", "queued", "pending", "degraded", "draining", "scheduled", "unverified", "stale"]);
const badStates = new Set(["failed", "error", "unavailable", "unhealthy", "timeout", "denied", "expired"]);
export type StatusTone = "ok" | "warn" | "bad" | "neutral";
export function statusTone(state: string): StatusTone {
  const key = state.toLowerCase();
  return okStates.has(key) ? "ok" : warnStates.has(key) ? "warn" : badStates.has(key) ? "bad" : "neutral";
}
export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> { state: string; tone?: StatusTone | undefined }
/** A dot plus the reported state text; the text stays first so it reads and copies verbatim. */
export function StatusBadge({ state, tone, className = "", children, ...props }: StatusBadgeProps) {
  return <span {...props} className={`q-status ${className}`} data-tone={tone ?? statusTone(state)}>{state}{children}</span>;
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: IconName }
export function EmptyState({ title, description, action, icon, className = "", ...props }: EmptyStateProps) {
  return <div {...props} className={`q-empty ${className}`}>{icon && <Icon name={icon} size={24} />}<h2 className="q-empty__title">{title}</h2>{description && <p className="q-empty__description">{description}</p>}{action}</div>;
}

export interface Toast { id: string; message: ReactNode; tone?: "neutral" | "success" | "error" }
export interface ToastRegionProps extends HTMLAttributes<HTMLDivElement> { toasts: readonly Toast[]; onDismiss?: (id: string) => void; dismissLabel?: string }
export function ToastRegion({ toasts, onDismiss, dismissLabel = "Dismiss notification", className = "", ...props }: ToastRegionProps) {
  return <div {...props} className={`q-toasts ${className}`} aria-label={props["aria-label"] ?? "Notifications"}>
    <div role="status" aria-live="polite" aria-atomic="false">{toasts.filter(toast => toast.tone !== "error").map(toast => <div key={toast.id} className={`q-toast q-toast--${toast.tone ?? "neutral"}`}><span className="q-toast__message">{toast.message}</span>{onDismiss && <IconButton icon="close" label={dismissLabel} variant="ghost" onClick={() => onDismiss(toast.id)} />}</div>)}</div>
    <div role="alert" aria-atomic="false">{toasts.filter(toast => toast.tone === "error").map(toast => <div key={toast.id} className="q-toast q-toast--error"><span className="q-toast__message">{toast.message}</span>{onDismiss && <IconButton icon="close" label={dismissLabel} variant="ghost" onClick={() => onDismiss(toast.id)} />}</div>)}</div>
  </div>;
}
