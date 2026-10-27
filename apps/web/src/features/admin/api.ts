import type { createClient } from "@quire/contracts";

export type AdminClient = ReturnType<typeof createClient>;
export type AdminPageProps = {
  readonly path: string;
  readonly client: AdminClient;
  readonly navigate: (path: string) => void;
  readonly onSessionChange: () => Promise<void>;
};
export type WireInput = {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string | undefined>>;
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed. Check the connection and retry.";
}

/** Parse user-authored JSON once, before the endpoint boundary validates its shape. */
export function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

export function downloadBytes(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
