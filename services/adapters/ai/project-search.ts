import { z } from "zod";
import type { Id, SqlExecutor } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { searchProject } from "../../core/base/search";
import { isCodePointBoundary } from "../../core/base/unicode";
import { digest, scopeOf } from "./model";
import type { RunRecord } from "./model";
import type { AiStore } from "./store";

export const SearchArguments = z.strictObject({ query: z.string().trim().min(1).max(1000) });
type Excerpt = {
  readonly fileId: Id; readonly path: string; readonly from: number; readonly to: number; readonly text: string;
  readonly epoch: number; readonly revision: number;
};
/** Invocation-local context only. Excerpts and queries are never persisted. */
export class ProjectSearch {
  readonly excerpts: Excerpt[] = [];
  private branch: { readonly id: Id; readonly revision: number; readonly epoch: number } | undefined;
  constructor(readonly store: AiStore, readonly run: RunRecord, readonly signal: AbortSignal) {}
  async current(db: SqlExecutor) {
    this.signal.throwIfAborted();
    const checked = await this.store.recheck(this.run, db);
    const row = await this.store.record(this.run.id, db);
    if (row.status !== "running") throw new ServiceError("AI_CANCELED", 409, "Search run is no longer running");
    const core = this.store.core(db);
    const branch = await core.getBranch(scopeOf(this.run));
    if (this.branch && (branch.id !== this.branch.id || branch.epoch !== this.branch.epoch || branch.revision !== this.branch.revision)) {
      throw new ServiceError("AI_CONTEXT_STALE", 409, "Searched branch changed");
    }
    for (const excerpt of this.excerpts) {
      const document = await core.readDocument(scopeOf(this.run), excerpt.fileId);
      if (document.file.path !== excerpt.path || document.file.version.epoch !== excerpt.epoch ||
        document.file.version.revision !== excerpt.revision || document.text.slice(excerpt.from, excerpt.to) !== excerpt.text) {
        throw new ServiceError("AI_CONTEXT_STALE", 409, "Searched source changed");
      }
    }
    return checked;
  }
  async search(query: string) {
    return this.store.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      const checked = await this.current(tx);
      const core = this.store.core(tx);
      this.branch ??= await core.getBranch(scopeOf(this.run));
      const result = await searchProject(core, scopeOf(this.run), { q: query, case: "false", regex: "false", word: "false" });
      const hits: Excerpt[] = [];
      for (const match of result.matches.slice(0, 10)) {
        const document = await core.readDocument(scopeOf(this.run), match.fileId);
        const lines = document.text.split("\n");
        const from = lines.slice(0, match.line - 1).reduce((offset, line) => offset + line.length + 1, 0)
          + match.column - 1;
        let to = Math.min(document.text.length, from + 4096);
        if (!isCodePointBoundary(document.text, to)) to--;
        const text = document.text.slice(from, to);
        if (checked.settings.secret && (text.includes(checked.settings.secret) || document.file.path.includes(checked.settings.secret))) {
          throw new ServiceError("PROVIDER_SECRET_LEAK", 502, "Search context contains a protected credential");
        }
        hits.push({ fileId: document.file.id, path: document.file.path, from, to, text,
          epoch: document.file.version.epoch, revision: document.file.version.revision });
      }
      this.excerpts.push(...hits);
      await this.current(tx);
      return { hits };
    });
  }
  async outbound(input: { readonly messages: unknown; readonly selected: readonly { readonly id: Id; readonly path: string }[] }) {
    await this.store.context.uow.run(async tx => {
      await tx.lock("quire:accounts");
      await this.current(tx);
      const files = [...input.selected, ...this.excerpts.map(file => ({ id: file.fileId, path: file.path }))];
      const manifest = files.filter((file, index) => files.findIndex(other => other.id === file.id) === index);
      await tx.run("UPDATE ai_run_metadata SET manifest_json=?,context_digest=? WHERE run_id=?",
        [JSON.stringify(manifest), digest(JSON.stringify(input.messages)), this.run.id]);
    });
    this.signal.throwIfAborted();
  }
}
