import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import {
  Heading1, Heading2, Heading3, List, ListOrdered, ListTodo, Quote,
  Code, Code2, Minus, Table as TableIcon, Image as ImageIcon, Type, Upload,
} from "@/lib/heroicons";
import type { Editor, Range } from "@tiptap/core";
import { useLanguage } from "@/contexts/LanguageContext";

export interface SlashItem {
  titleKey: string;
  descKey: string;
  title: string;
  description: string;
  icon: typeof Type;
  keywords: string[];
  command: (props: { editor: Editor; range: Range }) => void;
}

const items: SlashItem[] = [
  { titleKey: "ed_slash_text_title", descKey: "ed_slash_text_desc", title: "Text", description: "Plain paragraph", icon: Type, keywords: ["text", "p"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("paragraph").run() },
  { titleKey: "ed_slash_h1_title", descKey: "ed_slash_h1_desc", title: "Heading 1", description: "Big title", icon: Heading1, keywords: ["h1", "title"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run() },
  { titleKey: "ed_slash_h2_title", descKey: "ed_slash_h2_desc", title: "Heading 2", description: "Section heading", icon: Heading2, keywords: ["h2"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run() },
  { titleKey: "ed_slash_h3_title", descKey: "ed_slash_h3_desc", title: "Heading 3", description: "Subsection", icon: Heading3, keywords: ["h3"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run() },
  { titleKey: "ed_slash_ul_title", descKey: "ed_slash_ul_desc", title: "Bullet List", description: "Unordered list", icon: List, keywords: ["ul", "list", "bullet"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
  { titleKey: "ed_slash_ol_title", descKey: "ed_slash_ol_desc", title: "Numbered List", description: "Ordered list", icon: ListOrdered, keywords: ["ol", "ordered"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
  { titleKey: "ed_slash_task_title", descKey: "ed_slash_task_desc", title: "To-do", description: "Checklist", icon: ListTodo, keywords: ["task", "todo", "check"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run() },
  { titleKey: "ed_slash_quote_title", descKey: "ed_slash_quote_desc", title: "Quote", description: "Blockquote", icon: Quote, keywords: ["quote", "blockquote"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
  { titleKey: "ed_slash_codeblock_title", descKey: "ed_slash_codeblock_desc", title: "Code Block", description: "Syntax-highlighted code", icon: Code2, keywords: ["code", "pre"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
  { titleKey: "ed_slash_code_title", descKey: "ed_slash_code_desc", title: "Inline Code", description: "Monospace inline", icon: Code, keywords: ["inline", "code"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCode().run() },
  { titleKey: "ed_slash_hr_title", descKey: "ed_slash_hr_desc", title: "Divider", description: "Horizontal rule", icon: Minus, keywords: ["hr", "divider", "rule"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
  { titleKey: "ed_slash_table_title", descKey: "ed_slash_table_desc", title: "Table", description: "3x3 table", icon: TableIcon, keywords: ["table"],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { titleKey: "ed_slash_image_title", descKey: "ed_slash_image_desc", title: "Image", description: "Embed by URL", icon: ImageIcon, keywords: ["image", "img", "picture", "url", "web"],
    command: ({ editor, range }) => {
      const url = window.prompt("Image URL");
      if (!url) return;
      editor.chain().focus().deleteRange(range).setImage({ src: url }).run();
    } },
  { titleKey: "ed_slash_upload_title", descKey: "ed_slash_upload_desc", title: "Upload file", description: "Image, PDF or audio from your device", icon: Upload, keywords: ["upload", "file", "pdf", "audio", "attach", "vault"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      window.dispatchEvent(new CustomEvent("continuum:editor-upload"));
    } },
  { titleKey: "ed_slash_vault_title", descKey: "ed_slash_vault_desc", title: "From vault", description: "Insert a file already in your vault", icon: ImageIcon, keywords: ["vault", "existing", "cofre", "file", "arquivo"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      window.dispatchEvent(new CustomEvent("continuum:vault-pick", { detail: { editor } }));
    } },
];

interface SlashListProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}
interface SlashListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const SlashList = forwardRef<SlashListRef, SlashListProps>(({ items, command }, ref) => {
  const { t } = useLanguage();
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [items]);
  const select = (i: number) => { const it = items[i]; if (it) command(it); };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") { setSelected((s) => (s + items.length - 1) % Math.max(items.length, 1)); return true; }
      if (event.key === "ArrowDown") { setSelected((s) => (s + 1) % Math.max(items.length, 1)); return true; }
      if (event.key === "Enter") { select(selected); return true; }
      return false;
    },
  }));

  return (
    <div className="rounded-xl border border-border/60 bg-popover/95 backdrop-blur-md shadow-2xl overflow-hidden min-w-[280px] py-1">
      <div className="px-3 py-2 border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
        {t("ed_slash_insert_block")}
      </div>
      <div className="max-h-80 overflow-y-auto py-1">
        {items.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">{t("ed_slash_no_matches")}</div>
        ) : items.map((item, i) => {
          const Icon = item.icon;
          return (
            <button
              key={item.title}
              onMouseDown={(e) => { e.preventDefault(); select(i); }}
              className={`flex items-center gap-3 w-full px-3 py-2 text-left text-sm transition-colors ${
                i === selected ? "bg-accent text-accent-foreground" : "text-popover-foreground hover:bg-accent/50"
              }`}
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-md bg-muted text-muted-foreground">
                <Icon className="w-3.5 h-3.5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{t(item.titleKey)}</div>
                <div className="text-[10px] text-muted-foreground truncate">{t(item.descKey)}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});
SlashList.displayName = "SlashList";

export const SlashCommands = Extension.create({
  name: "slashCommands",
  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        command: ({ editor, range, props }: any) => {
          props.command({ editor, range });
        },
      } as Partial<SuggestionOptions>,
    };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }) => {
          const q = query.toLowerCase();
          return items.filter(
            (it) =>
              !q ||
              it.title.toLowerCase().includes(q) ||
              it.keywords.some((k) => k.includes(q))
          );
        },
        render: () => {
          let component: ReactRenderer<SlashListRef> | null = null;
          let popup: TippyInstance[] | null = null;
          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashList, { props, editor: props.editor });
              if (!props.clientRect) return;
              popup = tippy("body", {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                theme: "transparent",
                maxWidth: 360,
                offset: [0, 10],
                duration: 0,
                hideOnClick: false,
                zIndex: 80,
                popperOptions: {
                  strategy: "fixed",
                  modifiers: [
                    { name: "flip", options: { fallbackPlacements: ["top-start", "bottom-start"], padding: 8 } },
                    { name: "preventOverflow", options: { padding: 8 } },
                  ],
                },
              });
              const firstPopup = popup?.[0];
              const box = firstPopup?.popper?.querySelector(".tippy-box") as HTMLElement | null;
              const content = firstPopup?.popper?.querySelector(".tippy-content") as HTMLElement | null;
              if (box) {
                box.style.background = "transparent";
                box.style.border = "none";
                box.style.boxShadow = "none";
                box.style.padding = "0";
                box.style.maxWidth = "none";
                box.style.zIndex = "80";
              }
              if (content) {
                content.style.padding = "0";
                content.style.background = "transparent";
              }
            },
            onUpdate(props) {
              component?.updateProps(props);
              if (props.clientRect) popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
            },
            onKeyDown(props) {
              if (props.event.key === "Escape") { popup?.[0]?.hide(); return true; }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit() { popup?.[0]?.destroy(); component?.destroy(); },
          };
        },
      } as any),
    ];
  },
});
