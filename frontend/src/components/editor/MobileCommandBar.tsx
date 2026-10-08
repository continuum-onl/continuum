import { useEffect, useState, useCallback, useRef } from "react";
import type { PointerEvent } from "react";
import type { Editor } from "@tiptap/core";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code,
  Code2,
  Minus,
  Type,
  Bold,
  Italic,
  Strikethrough,
  Link as LinkIcon,
  Table as TableIcon,
  Upload,
  FolderOpen,
  Trash2,
} from "@/lib/heroicons";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

export const EDITOR_UPLOAD_EVENT = "continuum:editor-upload";

function requestUpload(accept: string) {
  window.dispatchEvent(new CustomEvent(EDITOR_UPLOAD_EVENT, { detail: { accept } }));
}

interface Props {
  editor: Editor | null;
}

interface Cmd {
  key: string;
  label: string;
  icon: typeof Type;
  run: (e: Editor, t?: (key: string) => string) => void;
  active?: (e: Editor) => boolean;
}

const COMMANDS: Cmd[] = [
  { key: "text", label: "ed_cmd_text", icon: Type, run: (e) => e.chain().focus().setNode("paragraph").run() },
  { key: "h1", label: "ed_cmd_h1", icon: Heading1, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive("heading", { level: 1 }) },
  { key: "h2", label: "ed_cmd_h2", icon: Heading2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
  { key: "h3", label: "ed_cmd_h3", icon: Heading3, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive("heading", { level: 3 }) },
  { key: "bold", label: "ed_cmd_bold", icon: Bold, run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
  { key: "italic", label: "ed_cmd_italic", icon: Italic, run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic") },
  { key: "strike", label: "ed_cmd_strike", icon: Strikethrough, run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive("strike") },
  { key: "ul", label: "ed_cmd_ul", icon: List, run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
  { key: "ol", label: "ed_cmd_ol", icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
  { key: "task", label: "ed_cmd_task", icon: ListTodo, run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive("taskList") },
  { key: "quote", label: "ed_cmd_quote", icon: Quote, run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
  { key: "code", label: "ed_cmd_code", icon: Code, run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive("code") },
  { key: "codeblock", label: "ed_cmd_codeblock", icon: Code2, run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive("codeBlock") },
  { key: "hr", label: "ed_cmd_hr", icon: Minus, run: (e) => e.chain().focus().setHorizontalRule().run() },
  {
    key: "link",
    label: "ed_cmd_link",
    icon: LinkIcon,
    run: (e, t) => {
      const url = window.prompt(t ? t("ed_prompt_url") : "URL");
      if (!url) return;
      e.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    },
  },
  { key: "upload", label: "ed_cmd_upload", icon: Upload, run: () => requestUpload("image/*,application/pdf,audio/*") },
  { key: "vault", label: "ed_cmd_vault", icon: FolderOpen, run: (e) => {
    e.chain().focus().run();
    window.dispatchEvent(new CustomEvent("continuum:vault-pick", { detail: { editor: e } }));
  } },
  { key: "table", label: "ed_cmd_table", icon: TableIcon, run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
];

const TABLE_ACTIONS: Array<{ key: string; label: string; run: (e: Editor) => void; danger?: boolean }> = [
  { key: "colBefore", label: "← Col", run: (e) => e.chain().focus().addColumnBefore().run() },
  { key: "colAfter", label: "Col →", run: (e) => e.chain().focus().addColumnAfter().run() },
  { key: "rowBefore", label: "↑ Row", run: (e) => e.chain().focus().addRowBefore().run() },
  { key: "rowAfter", label: "Row ↓", run: (e) => e.chain().focus().addRowAfter().run() },
  { key: "header", label: "Header", run: (e) => e.chain().focus().toggleHeaderRow().run() },
  { key: "merge", label: "Merge", run: (e) => e.chain().focus().mergeOrSplit().run() },
  { key: "delCol", label: "− Col", run: (e) => e.chain().focus().deleteColumn().run(), danger: true },
  { key: "delRow", label: "− Row", run: (e) => e.chain().focus().deleteRow().run(), danger: true },
  { key: "delTable", label: "Delete table", run: (e) => e.chain().focus().deleteTable().run(), danger: true },
];

export function MobileCommandBar({ editor }: Props) {
  const isMobile = useIsMobile();
  const { t } = useLanguage(); 
  const [offset, setOffset] = useState(0);
  const [kbOpen, setKbOpen] = useState(false);
  const [inTable, setInTable] = useState(false);
  const [tableMode, setTableMode] = useState(false);
  const pointerState = useRef<{ x: number; y: number; pointerId: number | null; cancelled: boolean }>({
    x: 0,
    y: 0,
    pointerId: null,
    cancelled: false,
  });

  // Track whether the caret currently sits inside a table.
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      const active = editor.isActive("table");
      setInTable(active);
      if (!active) setTableMode(false);
      else setTableMode(true);
    };
    sync();
    editor.on("selectionUpdate", sync);
    editor.on("transaction", sync);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("transaction", sync);
    };
  }, [editor]);

  // Track visual viewport for keyboard position.
  useEffect(() => {
    if (!isMobile || typeof window === "undefined") return;
    const vv = window.visualViewport;
    const update = () => {
      if (!vv) {
        setKbOpen(false);
        setOffset(0);
        return;
      }
      const kbHeight = window.innerHeight - vv.height - vv.offsetTop;
      // Consider keyboard "open" when at least 120px is occluded.
      const open = kbHeight > 120;
      setKbOpen(open);
      setOffset(open ? kbHeight : 0);
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [isMobile]);

  const insert = useCallback(
    (cmd: Cmd) => {
      if (!editor) return;
      // Keep editor focused so keyboard stays open.
      cmd.run(editor, t);
    },
    [editor, t]
  );

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    pointerState.current.pointerId = e.pointerId;
    pointerState.current.x = e.clientX;
    pointerState.current.y = e.clientY;
    pointerState.current.cancelled = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (pointerState.current.pointerId !== e.pointerId) return;
    const dx = Math.abs(e.clientX - pointerState.current.x);
    const dy = Math.abs(e.clientY - pointerState.current.y);
    if (dx > 10 || dy > 10) {
      pointerState.current.cancelled = true;
    }
  };

  const handlePointerUp = (e: PointerEvent<HTMLButtonElement>, cmd: Cmd) => {
    if (pointerState.current.pointerId !== e.pointerId) return;
    const cancelled = pointerState.current.cancelled;
    pointerState.current.pointerId = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (cancelled) return;
    e.preventDefault();
    insert(cmd);
  };

  const handlePointerCancel = (e: PointerEvent<HTMLButtonElement>) => {
    if (pointerState.current.pointerId !== e.pointerId) return;
    pointerState.current.pointerId = null;
    pointerState.current.cancelled = true;
  };

  if (!isMobile || !editor) return null;
  // Never surface editing controls while the note is in view mode.
  if (!editor.isEditable) return null;
  if (!kbOpen && !inTable) return null;

  return (
    <div
      role="toolbar"
      aria-label={t("editor_commands") || "Editor commands"}
      className={cn(
        "fixed left-2 right-2 z-[60] flex flex-col gap-1 rounded-2xl border border-border/10",
        "bg-background/90 backdrop-blur-xl shadow-2xl px-2 py-1.5"
      )}
      style={{
        bottom: `calc(${offset}px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 8px)`,
        touchAction: "pan-x",
      }}
      // Prevent iOS/Android from stealing focus from the editor.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      {inTable && tableMode && (
        <div className="flex items-center gap-1 border-b border-border/10 pb-1.5">
          <span className="shrink-0 px-1 text-[9px] uppercase tracking-widest text-muted-foreground">
            <TableIcon className="h-3.5 w-3.5" />
          </span>
          <div className="flex-1 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1 min-w-max">
              {TABLE_ACTIONS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={(e) => handlePointerUp(e, { key: a.key, label: a.label, icon: TableIcon, run: a.run })}
                  onPointerCancel={handlePointerCancel}
                  onTouchStart={(e) => e.preventDefault()}
                  onTouchEnd={(e) => e.preventDefault()}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 h-8 text-[12px] transition-colors",
                    a.danger
                      ? "bg-red-500/10 text-red-300 hover:bg-red-500/20"
                      : "bg-foreground/[0.06] text-muted-foreground hover:bg-foreground/10"
                  )}
                  aria-label={a.label}
                >
                  {a.key === "delTable" ? <Trash2 className="h-3.5 w-3.5" /> : null}
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-1">
      <div className="flex-1 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1 min-w-max">
          {COMMANDS.map((c) => {
            const Icon = c.icon;
            const active = c.active?.(editor) ?? false;
            return (
              <button
                key={c.key}
                type="button"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={(e) => handlePointerUp(e, c)}
                onPointerCancel={handlePointerCancel}
                onTouchStart={(e) => e.preventDefault()}
                onTouchEnd={(e) => e.preventDefault()}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 h-9 text-[12px] transition-colors",
                  active
                    ? "bg-foreground text-background"
                    : "bg-foreground/[0.06] text-muted-foreground hover:bg-foreground/10"
                )}
                aria-pressed={active}
                aria-label={t(c.label)}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{t(c.label)}</span>
              </button>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
}
