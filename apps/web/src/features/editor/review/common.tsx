import type { ReactNode } from "react";
import { EditorApiError } from "../shared";

export function errorMessage(error: unknown): string {
  if (error instanceof EditorApiError) return error.message;
  if (error instanceof DOMException) return error.message;
  if (error instanceof Error) return error.message;
  return "The request failed.";
}

export function PanelMessage({ tone = "neutral", children }: {
  readonly tone?: "neutral" | "error" | "success";
  readonly children: ReactNode;
}) {
  return <p className={`quire-review__message quire-review__message--${tone}`}
    role={tone === "error" ? "alert" : "status"}>{children}</p>;
}

export function initials(name: string): string {
  return name.split(/\s+/u).filter(Boolean).slice(0, 2)
    .map(part => part.slice(0, 1).toUpperCase()).join("") || "?";
}

export function localTime(instant: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(instant));
}

export const reviewRoles = ["editor", "reviewer", "viewer"] as const;
