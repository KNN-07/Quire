import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { FileEntry, Id } from "@quire/contracts";
import { Button, Icon } from "../../../ui";
import type { IconName } from "../../../ui";

const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "eps"]);
function fileIcon(file: FileEntry): IconName {
  if (file.kind === "folder") return "folder";
  const extension = file.path.split(".").at(-1)?.toLowerCase() ?? "";
  if (file.link) return "link";
  if (extension === "bib") return "book";
  if (extension === "pdf") return "pdf";
  if (imageExtensions.has(extension)) return "image";
  if (extension === "yml" || extension === "yaml" || extension === "json") return "sliders";
  if (extension === "py" || extension === "sty" || extension === "cls") return "code";
  return "file";
}
type TreeRowStyle = CSSProperties & { readonly "--qe-tree-level": number };
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
    {rows.map((file, index) => {
      const level = file.path.split("/").slice(0, -1).filter((_, depth, parts) => folderPaths.has(parts.slice(0, depth + 1).join("/"))).length + 1;
      const slash = file.path.lastIndexOf("/");
      const indent: TreeRowStyle = { "--qe-tree-level": level - 1 };
      const hint = file.link ? "Linked" : !file.editable && file.kind === "file" ? "Read only" : null;
      return <Button key={file.id} role="treeitem" variant="ghost" disabled={disabled}
      className="editor-tools__file" title={file.path} aria-label={hint ? `${file.path}, ${hint.toLowerCase()}` : file.path}
      style={indent}
      aria-level={level} aria-selected={selected === file.id}
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
      <span className="editor-tools__marker" aria-hidden="true">{file.kind === "folder" ? <Icon name={collapsed.has(file.path) ? "chevronRight" : "chevronDown"} size={14} /> : null}</span>
      <Icon name={fileIcon(file)} size={15} className="editor-tools__kind" data-kind={file.kind === "folder" ? "folder" : file.path.split(".").at(-1)} />
      <span className="editor-tools__path">{slash > 0 && <span className={`editor-tools__dir${folderPaths.has(file.path.slice(0, slash)) ? " editor-tools__dir--nested" : ""}`}>{file.path.slice(0, slash + 1)}</span>}{file.path.slice(slash + 1)}</span>
      {hint && <span className="editor-tools__hint">{hint}</span>}
    </Button>;
    })}
    {files.length === 0 && <p>No files. Create a file or upload project sources.</p>}
  </div>;
}
