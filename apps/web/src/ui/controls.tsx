import { forwardRef, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "neutral" | "primary" | "dark" | "ai" | "success" | "danger" | "ghost";
  size?: "small" | "regular" | "large";
  busy?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "neutral", size = "regular", busy = false, disabled, className = "", children, type = "button", ...props }, ref,
) {
  return <button {...props} ref={ref} type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={`q-button q-button--${variant} q-button--${size}${busy ? " q-button--busy" : ""} ${className}`}>{busy && <Spinner label="Working" />}{children}</button>;
});

export interface IconButtonProps extends Omit<ButtonProps, "children" | "aria-label"> {
  label: string;
  icon: IconName;
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, className = "", title = label, ...props }, ref,
) {
  return <Button {...props} ref={ref} title={title} aria-label={label} className={`q-icon-button ${className}`}><Icon name={icon} /></Button>;
});

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, id, className = "", "aria-describedby": describedBy, ...props }, ref,
) {
  const generated = useId();
  const controlId = id ?? generated;
  const description = [describedBy, hint ? `${controlId}-hint` : "", error ? `${controlId}-error` : ""].filter(Boolean).join(" ") || undefined;
  return <div className={`q-field ${className}`}>
    <label className="q-field__label" htmlFor={controlId}>{label}</label>
    <input {...props} id={controlId} ref={ref} className="q-input" aria-describedby={description} aria-invalid={error ? true : props["aria-invalid"]} />
    {hint && <p className="q-field__hint" id={`${controlId}-hint`}>{hint}</p>}
    {error && <p className="q-field__error" id={`${controlId}-error`}>{error}</p>}
  </div>;
});

export interface TabItem { value: string; label: ReactNode; content: ReactNode; disabled?: boolean }
export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  label: string;
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}
export function Tabs({ label, items, value, defaultValue, onValueChange, className = "", ...props }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue ?? items.find(item => !item.disabled)?.value);
  const selected = value ?? internal;
  const prefix = useId();
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const choose = (next: string) => { if (value === undefined) setInternal(next); onValueChange?.(next); };
  return <div {...props} className={`q-tabs ${className}`}>
    <div role="tablist" aria-label={label} className="q-tabs__list">
      {items.map((item, index) => <button type="button" role="tab" key={item.value} id={`${prefix}-tab-${index}`} aria-controls={`${prefix}-panel-${index}`} aria-selected={selected === item.value} disabled={item.disabled} tabIndex={selected === item.value ? 0 : -1} className="q-tab"
        ref={node => { if (node) refs.current.set(item.value, node); else refs.current.delete(item.value); }}
        onClick={() => choose(item.value)}
        onKeyDown={event => {
          const enabled = items.filter(tab => !tab.disabled);
          const current = enabled.findIndex(tab => tab.value === item.value);
          const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
          let next: TabItem | undefined;
          if (event.key === "Home") next = enabled[0];
          else if (event.key === "End") next = enabled.at(-1);
          else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            const delta = (event.key === "ArrowRight" ? 1 : -1) * (rtl ? -1 : 1);
            next = enabled[(current + delta + enabled.length) % enabled.length];
          }
          if (next) { event.preventDefault(); choose(next.value); refs.current.get(next.value)?.focus(); }
        }}>{item.label}</button>)}
    </div>
    {items.map((item, index) => <div key={item.value} role="tabpanel" id={`${prefix}-panel-${index}`} aria-labelledby={`${prefix}-tab-${index}`} hidden={selected !== item.value} tabIndex={0} className="q-tabs__panel">{item.content}</div>)}
  </div>;
}

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> { label?: string }
export function Spinner({ label = "Loading", className = "", ...props }: SpinnerProps) {
  return <span {...props} role="status" className={className}><span className="q-spinner" aria-hidden="true" /><span className="q-sr-only">{label}</span></span>;
}
