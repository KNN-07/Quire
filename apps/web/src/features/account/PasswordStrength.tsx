import { useState } from "react";
import { Field } from "../../ui";

/** Length-only guidance, not an authentication rule or a security estimate. */
export function PasswordCreationField({ label, disabled = false }: {
  readonly label: string;
  readonly disabled?: boolean;
}) {
  const [length, setLength] = useState(0);
  const level = length === 0 ? 0 : length < 12 ? 1 : length < 16 ? 2 : length < 24 ? 3 : 4;
  const guidance = level === 0 ? "Use at least 12 characters."
    : level === 1 ? "Below the 12-character minimum."
    : level === 2 ? "Minimum length met."
    : level === 3 ? "Long password."
    : "Very long password.";
  return <Field label={label} name="password" type="password" minLength={12} maxLength={1024}
    required autoComplete="new-password" disabled={disabled}
    onChange={event => setLength(event.currentTarget.value.length)}
    hint={<>
      <span aria-hidden="true" style={{ display: "flex", gap: 4, margin: "4px 0 6px" }}>
        {[1, 2, 3, 4].map(segment => <span key={segment} style={{
          flex: 1, height: 4, borderRadius: 2,
          background: segment <= level ? "var(--q-brand)" : "var(--q-border)",
        }} />)}
      </span>
      <span role="status" aria-live="polite" aria-atomic="true">{guidance}</span>
    </>} />;
}
