import type { endpoints, Preferences, ResponseOf } from "@quire/contracts";
import type { GitPanelProps as SharedGitPanelProps } from "../shared";

export type GitPanelProps = SharedGitPanelProps & {
  readonly preferences?: Pick<Preferences, "compileBeforeCommit">;
};

export type GitStatus = ResponseOf<typeof endpoints.gitStatus>;
export type GitBranch = ResponseOf<typeof endpoints.gitBranches>[number];
export type GitLog = ResponseOf<typeof endpoints.gitLog>["items"];
export type GitConflict = Extract<ResponseOf<typeof endpoints.gitMerge>, { readonly kind: "conflict" }>["conflict"];
export type GitResolution =
  | { readonly path: string; readonly choice: "ours" | "theirs" | "delete" }
  | { readonly path: string; readonly choice: "text"; readonly text: string };
export type DiffLayout = "unified" | "split" | "rendered";
export type CompareTarget = "working" | "staged";

export function shortOid(value: string): string {
  return value.replace(/^sha(?:1|256):/, "").slice(0, 9);
}

export function cloneUrl(projectId: string): string {
  return new URL(`/git/${encodeURIComponent(projectId)}.git`, location.origin).toString();
}
