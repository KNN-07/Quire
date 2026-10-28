import { useRef, useState } from "react";
import type { FileEntry, Id } from "@quire/contracts";
import { Button } from "../../../ui";

type Props = {
  readonly files: readonly FileEntry[];
  readonly selected: Id | null;
  readonly disabled: boolean;
  readonly onSelect: (file: FileEntry) => void;
  readonly onOpen: (file: FileEntry) => void;
};

export function FileTree({ files, selected, disabled, onSelect, onOpen }: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<Id | null>(null);
  const refs = useRef(new Map<Id, HTMLButtonElement>());
  const folderPaths = new Set(files.filter(file => file.kind === "folder").map(file => file.path));
  const rows = [...files].sort((a, b) => {
    const left = a.path.split("/");
    const right = b.path.split("/");
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      const order = (left[index] ?? "").localeCompare(right[index] ?? "", "en");
      if (order !== 0) return order;
    }
    return left.length - right.length;
  })
    .filter(file => ![...collapsed].some(path => file.path.startsWith(`${path}/`)));
  const tabStop = focused ?? selected ?? rows[0]?.id;
  const toggle = (path: string, open: boolean) => setCollapsed(previous => {
    const next = new Set(previous);
    if (open) next.delete(path); else next.add(path);
    return next;
  });
  return <div role="tree" aria-label="Project files" className="editor-tools__tree">
    {rows.map((file, index) => <Button key={file.id} role="treeitem" variant="ghost" disabled={disabled}
      className="editor-tools__file" title={file.path}
      aria-level={file.path.split("/").slice(0, -1).filter((_, depth, parts) => folderPaths.has(parts.slice(0, depth + 1).join("/"))).length + 1} aria-selected={selected === file.id}
      aria-expanded={file.kind === "folder" ? !collapsed.has(file.path) : undefined}
      tabIndex={tabStop === file.id ? 0 : -1}
      ref={node => { if (node) refs.current.set(file.id, node); else refs.current.delete(file.id); }}
      onFocus={() => setFocused(file.id)}
      onClick={() => { onSelect(file); if (file.kind === "folder") toggle(file.path, collapsed.has(file.path)); else onOpen(file); }}
      onKeyDown={event => {
        let target: FileEntry | undefined;
        switch (event.key) {
          case "ArrowDown": target = rows[index + 1]; break;
          case "ArrowUp": target = rows[index - 1]; break;
          case "Home": target = rows[0]; break;
          case "End": target = rows.at(-1); break;
          case "ArrowRight":
            if (file.kind === "folder") {
              if (collapsed.has(file.path)) toggle(file.path, true);
              else {
                const child = rows[index + 1];
                if (child?.path.startsWith(`${file.path}/`)) target = child;
              }
            }
            break;
          case "ArrowLeft":
            if (file.kind === "folder" && !collapsed.has(file.path)) toggle(file.path, false);
            else target = rows.findLast(item => item.kind === "folder" && file.path.startsWith(`${item.path}/`));
            break;
          default: return;
        }
        event.preventDefault();
        if (target) { onSelect(target); refs.current.get(target.id)?.focus(); }
      }}>
      <span aria-hidden="true">{selected === file.id ? "✓" : file.kind === "folder" ? collapsed.has(file.path) ? "▸" : "▾" : "·"}</span>
      <span className="editor-tools__path">{file.path}</span>
      {file.link && <span className="editor-tools__hint">Linked</span>}
      {!file.editable && !file.link && file.kind === "file" && <span className="editor-tools__hint">Read only</span>}
    </Button>)}
    {files.length === 0 && <p>No files. Create a file or upload project sources.</p>}
  </div>;
}
