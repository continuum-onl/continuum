import { useEditor, EditorContent, ReactRenderer, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useNavigate } from "react-router-dom";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import LinkExtension from "@tiptap/extension-link";
import Mention from "@tiptap/extension-mention";
import TaskList from "@tiptap/extension-task-list";
import { ClickableTaskItem } from "./extensions/ClickableTaskItem";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Image from "@tiptap/extension-image";
import Typography from "@tiptap/extension-typography";
import CharacterCount from "@tiptap/extension-character-count";
import Dropcursor from "@tiptap/extension-dropcursor";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Underline from "@tiptap/extension-underline";
import { Mathematics } from "@tiptap/extension-mathematics";
import "katex/dist/katex.min.css";
import { common, createLowlight } from "lowlight";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import "tippy.js/dist/tippy.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from "react";
import type { ChangeEvent } from "react";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import {
  Bold, Italic, Strikethrough, Code, Link as LinkIcon, Upload,
  Heading1, Heading2, Quote, List, ListOrdered, Trash2
} from "@/lib/heroicons";
import { entitiesApi, notesApi, vaultApi } from "@/lib/api";
import type { Entity } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { MentionList, type MentionListRef, type MentionItem } from "./MentionList";
import { SlashCommands } from "./SlashCommands";
import { VaultImage } from "./VaultImage";
import { VaultPdf } from "./VaultPdf";
import { VaultAudio } from "./VaultAudio";
import { AutoPair } from "./extensions/AutoPair";
import { EditorShortcuts } from "./extensions/EditorShortcuts";
import { HeadingFold } from "./extensions/HeadingFold";
import { LinkHover } from "./extensions/LinkHover";
import { SearchHighlight } from "./extensions/SearchHighlight";
import { FindReplace } from "./FindReplace";
import { StatusBar } from "./StatusBar";
import { MobileCommandBar } from "./MobileCommandBar";

export const EDITOR_UPLOAD_EVENT = "continuum:editor-upload";

const IMAGE_MIME_RE = /^image\//i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
const isImageFile = (file: File) => IMAGE_MIME_RE.test(file.type) || IMAGE_EXT_RE.test(file.name);
const PDF_EXT_RE = /\.pdf$/i;
const isPdfFile = (file: File) => file.type === "application/pdf" || PDF_EXT_RE.test(file.name);
const AUDIO_MIME_RE = /^audio\//i;
const AUDIO_EXT_RE = /\.(mp3|m4a|wav|ogg|aac)$/i;
const isAudioFile = (file: File) => AUDIO_MIME_RE.test(file.type) || AUDIO_EXT_RE.test(file.name);

const lowlight = createLowlight(common);

const isSafeEditorUrl = (href: string) => {
  const trimmed = href.trim();
  if (!trimmed) return false;

  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("javascript:") || lowered.startsWith("data:") || lowered.startsWith("vbscript:")) return false;
  if (lowered.startsWith("mailto:") || lowered.startsWith("tel:")) return true;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return true;

  try {
    const parsed = new URL(trimmed, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const NoteMention = Mention.extend({
  name: "noteMention",
  addAttributes() {
    return {
      ...this.parent?.(),
      type: {
        default: "NOTE",
        parseHTML: (el) => el.getAttribute("data-type") || "NOTE",
        renderHTML: () => ({ "data-type": "NOTE" }),
      },
    };
  },
});

/* ── Caches ── */
const TTL = 4000;
type Cache<T> = { token: string | null; at: number; data: T[]; pending: Promise<T[]> | null };
const entityCache: Cache<Entity> = { token: null, at: 0, data: [], pending: null };
const noteCache: Cache<{ id: string; title: string }> = { token: null, at: 0, data: [], pending: null };

const getToken = () => {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem("access_token") ?? window.localStorage.getItem("access_token");
};

/** Tracks every open mention popup so we can always clean up stragglers. */
const activeMentionPopups = new Set<TippyInstance>();

/** True while a mention suggestion session is open (prevents blur from killing it). */
let mentionSuggestionActive = false;

export const destroyAllMentionPopups = () => {
  activeMentionPopups.forEach((instance) => {
    try { instance.destroy(); } catch { /* already destroyed */ }
  });
  activeMentionPopups.clear();
};

export const resetEditorCaches = () => {
  Object.assign(entityCache, { token: null, at: 0, data: [], pending: null });
  Object.assign(noteCache, { token: null, at: 0, data: [], pending: null });
};


const loadEntities = async (): Promise<Entity[]> => {
  const token = getToken();
  if (entityCache.token !== token) Object.assign(entityCache, { token, at: 0, data: [], pending: null });
  if (entityCache.pending) return entityCache.pending;
  if (entityCache.data.length && Date.now() - entityCache.at < TTL) return entityCache.data;
  entityCache.pending = entitiesApi.list()
    .then(({ data }) => { entityCache.data = Array.isArray(data) ? data : []; entityCache.at = Date.now(); return entityCache.data; })
    .catch(() => []) .finally(() => { entityCache.pending = null; });
  return entityCache.pending;
};

const loadNotes = async () => {
  const token = getToken();
  if (noteCache.token !== token) Object.assign(noteCache, { token, at: 0, data: [], pending: null });
  if (noteCache.pending) return noteCache.pending;
  if (noteCache.data.length && Date.now() - noteCache.at < TTL) return noteCache.data;
  noteCache.pending = notesApi.list()
    .then(({ data }) => {
      const arr = Array.isArray(data) ? data : [];
      noteCache.data = arr.map((n: any) => ({ id: n.id, title: n.title }));
      noteCache.at = Date.now();
      return noteCache.data;
    })
    .catch(() => []).finally(() => { noteCache.pending = null; });
  return noteCache.pending;
};

/* ── Suggestion factory ── */
const buildSuggestion = (variant: "entity" | "note", currentNoteId?: string) => ({
  char: variant === "entity" ? "@" : "#",
  allowSpaces: variant === "note", 
  startOfLine: false,
  items: async ({ query }: { query: string }): Promise<MentionItem[]> => {
    const q = query.toLowerCase().trim();
    if (variant === "entity") {
      const entities = await loadEntities();
      const matches: MentionItem[] = entities
        .filter((e) => e.title.toLowerCase().includes(q))
        .slice(0, 8)
        .map((e) => ({ id: e.id, title: e.title, type: e.type }));
      if (q && !matches.some((m) => m.title.toLowerCase() === q)) {
        matches.push({ id: `__create__${q}`, title: query, type: "TOPIC", isCreate: true, createKind: "entity" });
      }
      return matches;
    }
    const notes = await loadNotes();
    const matches: MentionItem[] = notes
      .filter((n) => n.id !== currentNoteId && n.title.toLowerCase().includes(q))
      .slice(0, 8)
      .map((n) => ({ id: n.id, title: n.title, type: "NOTE" }));
    if (q && !matches.some((m) => m.title.toLowerCase() === q)) {
      matches.push({ id: `__create__${q}`, title: query, type: "NOTE", isCreate: true, createKind: "note" });
    }
    return matches;
  },
  command: ({ editor, range, props }: any) => {
    const item = props as MentionItem;
    const finalize = (id: string, label: string) => {
      const nodeName = variant === "entity" ? "mention" : "noteMention";
      const attrs = variant === "entity" ? { id, label } : { id, label, type: "NOTE" };
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
          { type: nodeName, attrs },
          { type: "text", text: " " },
        ])
        .run();
    };

    if (item.isCreate) {
      const title = item.title.trim();
      if (!title) return;
      if (item.createKind === "entity") {
        const entityType = item.type || "TOPIC"; 
        entitiesApi.create(title, entityType).then((res) => {
          const created = res.data as Entity;
          entityCache.data = [created, ...entityCache.data];
          finalize(created.id, created.title);
        });
        return;
      }
      notesApi.create(title, { type: "doc", content: [{ type: "paragraph" }] }).then((res) => {
        const created = res.data as { id: string; title: string };
        noteCache.data = [{ id: created.id, title: created.title }, ...noteCache.data];
        finalize(created.id, created.title);
      });
      return;
    }

    finalize(item.id, item.title);
  },
  render: () => {
    let component: ReactRenderer<MentionListRef> | null = null;
    let popup: TippyInstance | null = null;

    const teardown = () => {
      mentionSuggestionActive = false;
      if (popup) {
        activeMentionPopups.delete(popup);
        try { popup.destroy(); } catch { /* already destroyed */ }
        popup = null;
      }
      if (component) {
        try { component.destroy(); } catch { /* noop */ }
        component = null;
      }
    };

    return {
      onStart: (props: SuggestionProps<MentionItem>) => {
        // Any leftover popup (from an interrupted session) must go first.
        destroyAllMentionPopups();
        teardown();
        mentionSuggestionActive = true;
        component = new ReactRenderer(MentionList, {
          props: { ...props, query: props.query, variant },
          editor: props.editor,
        });
        if (!props.clientRect) {
          teardown();
          return;
        }
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
          onHidden: () => teardown(),
        })[0] ?? null;
        if (popup) {
          activeMentionPopups.add(popup);
          const box = popup.popper?.querySelector(".tippy-box") as HTMLElement | null;
          const content = popup.popper?.querySelector(".tippy-content") as HTMLElement | null;
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
        }
      },
      onUpdate(props: SuggestionProps<MentionItem>) {
        component?.updateProps({ ...props, query: props.query, variant });
        if (props.clientRect) popup?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
      },
      onKeyDown(props: SuggestionKeyDownProps) {
        if (props.event.key === "Escape") { teardown(); return true; }
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit() { teardown(); },
    };
  },
});


/* ── Component API ── */
export interface TiptapEditorHandle {
  getJSON: () => any;
  getHTML: () => string;
  getText: () => string;
  getEditor: () => Editor | null;
  triggerUpload: () => void;
}

interface Props {
  content?: any;
  onChange?: (json: any) => void;
  editable?: boolean;
  className?: string;
  currentNoteId?: string;
  onSave?: () => void;
  foldedHeadings?: number[];
  onFoldedHeadingsChange?: (indices: number[]) => void;
}

export const TiptapEditor = forwardRef<TiptapEditorHandle, Props>(
  ({ content, onChange, editable = true, className, currentNoteId, onSave, foldedHeadings, onFoldedHeadingsChange }, ref) => {
    const onFoldChangeRef = useRef(onFoldedHeadingsChange);
    onFoldChangeRef.current = onFoldedHeadingsChange;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    const navigate = useNavigate();

    const [isUploading, setIsUploading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [findOpen, setFindOpen] = useState(false);
    const [inTable, setInTable] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const updateTimerRef = useRef<number | null>(null);
    const { toast } = useToast();

    const uploadFileRef = useRef<(file: File) => Promise<void>>();

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
          codeBlock: false,
          dropcursor: false,
          link: false,
          underline: false,
        }),
        Underline,
        Highlight.configure({ multicolor: false }),
        Subscript,
        Superscript,
        Mathematics,
        AutoPair,
        LinkHover,
        SearchHighlight,
        EditorShortcuts.configure({
          onSave: () => onSaveRef.current?.(),
          onFind: () => setFindOpen(true),
        }),
        Placeholder.configure({
          placeholder: ({ node }) => {
            if (node.type.name === "heading") return "Heading";
            return "Type / for commands, @ for entities, # to link a note";
          },
          showOnlyWhenEditable: true,
          showOnlyCurrent: false,
        }),
        Typography,
        CharacterCount,
        Dropcursor.configure({ color: "hsl(var(--primary))", width: 2 }),
        LinkExtension.configure({
          openOnClick: false,
          autolink: true,
          validate: (href) => isSafeEditorUrl(href),
          HTMLAttributes: { class: "text-primary underline underline-offset-4 cursor-pointer" },
        }),
        Image.configure({ HTMLAttributes: { class: "rounded-lg my-4 max-w-full shadow-lg" } }),
        VaultImage,
        VaultPdf,
        VaultAudio,
        TaskList,
        // Custom node view: toggles via a real ProseMirror transaction, so it
        // works in read-only mode too and triggers onUpdate/auto-save.
        ClickableTaskItem.configure({ nested: true }),
        HeadingFold.configure({
          onFoldChange: (indices) => onFoldChangeRef.current?.(indices),
        }),
        Table.configure({ resizable: true, allowTableNodeSelection: true, lastColumnResizable: true }),
        TableRow,
        TableCell,
        TableHeader,
        CodeBlockLowlight.configure({ lowlight }),
        Mention.configure({
          HTMLAttributes: { class: "continuum-entity-mention" },
          renderHTML: ({ node, HTMLAttributes }: any) => [
            "span",
            {
              ...HTMLAttributes,
              "data-id": node.attrs.id,
              "data-label": node.attrs.label,
              "data-mention-type": "entity",
            },
            `@${node.attrs.label || node.attrs.id}`,
          ],
          suggestion: buildSuggestion("entity") as any,
        }),
        NoteMention.configure({
          HTMLAttributes: { class: "continuum-note-mention" },
          renderHTML: ({ node, HTMLAttributes }: any) => [
            "span",
            {
              ...HTMLAttributes,
              "data-id": node.attrs.id,
              "data-label": node.attrs.label,
              "data-mention-type": "note",
            },
            `#${node.attrs.label || node.attrs.id}`,
          ],
          suggestion: buildSuggestion("note", currentNoteId) as any,
        }),
        SlashCommands,
      ],
      content: content || { type: "doc", content: [{ type: "paragraph" }] },
      editable,
      editorProps: {
        attributes: {
          class: `continuum-editor max-w-none focus:outline-none min-h-[60vh] ${editable ? "" : "is-readonly"} ${className || ""}`,
        },
        handleClickOn: (_view, _pos, node, _nodePos, event) => {
          const name = node.type.name;
          if (name !== "mention" && name !== "noteMention") return false;
          const id = (node.attrs as any)?.id;
          if (!id) return false;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
          event.preventDefault();
          if (name === "noteMention") navigate(`/notes/${id}`);
          else navigate(`/entities/${id}`);
          return true;
        },
        handlePaste: (view, event) => {
          const items = event.clipboardData?.items;
          if (!items) return false;
          for (const item of items) {
            if (item.type.startsWith("image/") || item.type === "application/pdf" || item.type.startsWith("audio/")) {
              const file = item.getAsFile();
              if (file && uploadFileRef.current) {
                uploadFileRef.current(file);
                return true;
              }
            }
          }
          return false;
        },
      },
      onBlur: () => {
        // Leaving the editor must never leave a mention dropdown floating around.
        window.setTimeout(() => {
          // Touch devices have no :hover, so rely on the session flag instead.
          if (mentionSuggestionActive) return;
          destroyAllMentionPopups();
        }, 200);
      },
      onDestroy: () => destroyAllMentionPopups(),

      onUpdate: ({ editor }) => {
        // Throttled: avoids re-rendering the whole note page on every keystroke.
        if (updateTimerRef.current) window.clearTimeout(updateTimerRef.current);
        updateTimerRef.current = window.setTimeout(() => {
          if (editor.isDestroyed) return;
          onChangeRef.current?.(editor.getJSON());
        }, 300);
      },
    });

    const uploadFileToVault = useCallback(async (file: File) => {
      if (!editor) return;
      const formData = new FormData();
      formData.append("file", file);

      setIsUploading(true);
      try {
        const response = await vaultApi.upload(formData);
        const vaultFile = response.data;
        const vaultUrl = `/vault/download/${encodeURIComponent(vaultFile.id)}`;

        if (isImageFile(file)) {
          editor.chain().focus().insertContent([
            { type: "vaultImage", attrs: { vaultId: vaultFile.id, alt: vaultFile.fileName } },
            { type: "paragraph" },
          ]).run();
        } else if (isPdfFile(file)) {
          editor.chain().focus().insertContent([
            { type: "vaultPdf", attrs: { vaultId: vaultFile.id, fileName: vaultFile.fileName } },
            { type: "paragraph" },
          ]).run();
        } else if (isAudioFile(file)) {
          editor.chain().focus().insertContent([
            { type: "vaultAudio", attrs: { vaultId: vaultFile.id, fileName: vaultFile.fileName } },
            { type: "paragraph" },
          ]).run();
        } else {
          editor.chain().focus().insertContent([
            {
              type: "text",
              text: vaultFile.fileName,
              marks: [{ type: "link", attrs: { href: vaultUrl } }],
            },
            { type: "text", text: " " },
          ]).run();
        }

        toast({ title: "File uploaded", description: `${vaultFile.fileName} inserted into your note.` });
      } catch (error: any) {
        if (error?.response?.status === 415) {
          toast({ title: "Unsupported file type", variant: "destructive" });
        } else if (error?.response?.status === 400) {
          toast({ title: "Upload failed", description: "File may exceed your plan vault limit.", variant: "destructive" });
        } else {
          toast({ title: "Upload failed", variant: "destructive" });
        }
      } finally {
        setIsUploading(false);
      }
    }, [editor, toast]);

    useEffect(() => {
      uploadFileRef.current = uploadFileToVault;
    }, [uploadFileToVault]);

    const handleUploadClick = () => {
      fileInputRef.current?.click();
    };

    const handleDragEnter = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
    };

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const droppedFiles = e.dataTransfer.files;
      if (droppedFiles && droppedFiles.length > 0) {
        const file = droppedFiles[0];
        await uploadFileToVault(file);
      }
    };

    const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      event.target.value = "";
      await uploadFileToVault(file);
    };

    useImperativeHandle(ref, () => ({
      getJSON: () => editor?.getJSON(),
      getHTML: () => editor?.getHTML() || "",
      getText: () => editor?.getText() || "",
      getEditor: () => editor,
      triggerUpload: () => fileInputRef.current?.click(),
    }));

    useEffect(() => {
      if (!editor || !content) return;
      // never overwrite what the user is actively typing
      if (editor.isFocused) return;
      const a = JSON.stringify(editor.getJSON());
      const b = JSON.stringify(content);
      if (a !== b && typeof content === "object") editor.commands.setContent(content, { emitUpdate: false });
    }, [content, editor]);

    // Keep table toolbar visibility in sync with the caret (mouse, keyboard and touch).
    useEffect(() => {
      if (!editor) return;
      const sync = () => setInTable(editor.isActive("table"));
      editor.on("selectionUpdate", sync);
      editor.on("transaction", sync);
      editor.on("focus", sync);
      sync();
      return () => {
        editor.off("selectionUpdate", sync);
        editor.off("transaction", sync);
        editor.off("focus", sync);
      };
    }, [editor]);

    // Restore persisted heading fold state (server-side, per note).
    const appliedFoldsRef = useRef<string | null>(null);
    useEffect(() => {
      if (!editor || !foldedHeadings) return;
      const sig = `${currentNoteId ?? ""}:${foldedHeadings.join(",")}`;
      if (appliedFoldsRef.current === sig) return;
      appliedFoldsRef.current = sig;
      editor.commands.setFoldedHeadings(foldedHeadings);
    }, [editor, foldedHeadings, currentNoteId]);

    useEffect(() => {
      if (!editor) return;
      editor.setEditable(editable);
      const dom = editor.view?.dom as HTMLElement | undefined;
      dom?.classList.toggle("is-readonly", !editable);
    }, [editor, editable]);

    // Checklist toggling (including read-only mode) is handled by the
    // ClickableTaskItem node view, which dispatches a real transaction.

    // "/" command + toolbar upload entry point
    useEffect(() => {
      const open = (ev: Event) => {
        const accept = (ev as CustomEvent)?.detail?.accept as string | undefined;
        if (fileInputRef.current) {
          fileInputRef.current.accept = accept || "image/*,application/pdf,audio/*";
        }
        fileInputRef.current?.click();
      };
      window.addEventListener(EDITOR_UPLOAD_EVENT, open as EventListener);
      return () => window.removeEventListener(EDITOR_UPLOAD_EVENT, open as EventListener);
    }, []);

    // flush any pending throttled change so nothing is lost on unmount
    useEffect(() => {
      return () => {
        if (updateTimerRef.current) {
          window.clearTimeout(updateTimerRef.current);
          updateTimerRef.current = null;
          try {
            if (editor && !editor.isDestroyed) onChangeRef.current?.(editor.getJSON());
          } catch {
            /* editor already torn down */
          }
        }
      };
    }, [editor]);

    useEffect(() => {
      resetEditorCaches();
      const onFocus = () => resetEditorCaches();
      window.addEventListener("focus", onFocus);
      return () => window.removeEventListener("focus", onFocus);
    }, []);

    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf,audio/*"
          className="hidden"
          onChange={handleFileUpload}
        />
        {editor && (
          <>
            <BubbleMenu
              editor={editor}
              options={{ placement: "top" }}
              className="flex items-center gap-0.5 rounded-xl border border-border/10 bg-background/90 backdrop-blur-xl shadow-2xl px-1.5 py-1.5"
            >
              <ToolbarBtn editor={editor} action={(e) => e.chain().focus().toggleBold().run()} active={editor.isActive("bold")} icon={Bold} label="Bold" />
              <ToolbarBtn editor={editor} action={(e) => e.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} icon={Italic} label="Italic" />
              <ToolbarBtn editor={editor} action={(e) => e.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} icon={Strikethrough} label="Strike" />
              <ToolbarBtn editor={editor} action={(e) => e.chain().focus().toggleCode().run()} active={editor.isActive("code")} icon={Code} label="Code" />
              <div className="w-[1px] h-4 bg-foreground/10 mx-1" />
              <ToolbarBtn editor={editor} action={(e) => e.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} icon={Heading1} label="H1" />
              <ToolbarBtn editor={editor} action={(e) => e.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} icon={Heading2} label="H2" />
              <button
                type="button"
                title="H3"
                onMouseDown={(ev) => { ev.preventDefault(); editor.chain().focus().toggleHeading({ level: 3 }).run(); }}
                className={`px-1.5 h-7 text-[11px] font-semibold rounded-lg transition-colors ${editor.isActive("heading", { level: 3 }) ? "bg-primary/20 text-primary" : "text-neutral-400 hover:bg-foreground/10 hover:text-foreground"}`}
              >H3</button>
              <button
                type="button"
                title="Highlight"
                onMouseDown={(ev) => { ev.preventDefault(); editor.chain().focus().toggleHighlight().run(); }}
                className={`px-1.5 h-7 text-[11px] rounded-lg transition-colors ${editor.isActive("highlight") ? "bg-yellow-300/30 text-yellow-200" : "text-neutral-400 hover:bg-foreground/10 hover:text-foreground"}`}
              >==</button>
              <ToolbarBtn editor={editor} action={(e) => e.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} icon={Quote} label="Quote" />
              <ToolbarBtn editor={editor} action={(e) => e.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} icon={List} label="Bullets" />
              <ToolbarBtn editor={editor} action={(e) => e.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} icon={ListOrdered} label="Numbered" />
              <div className="w-[1px] h-4 bg-foreground/10 mx-1" />
              <ToolbarBtn
                editor={editor}
                action={(e) => {
                  const url = window.prompt("URL", e.getAttributes("link").href || "https://");
                  if (url === null) return;
                  if (url === "") { e.chain().focus().unsetLink().run(); return; }
                  if (!isSafeEditorUrl(url)) {
                    toast({
                      title: "Invalid link",
                      description: "Only http(s), mailto, tel, or internal paths are allowed.",
                      variant: "destructive",
                    });
                    return;
                  }
                  e.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
                }}
                active={editor.isActive("link")} icon={LinkIcon} label="Link" />
              <ToolbarBtn
                editor={editor}
                action={() => handleUploadClick()}
                active={false}
                icon={Upload}
                label={isUploading ? "Uploading…" : "Upload file"}
                disabled={isUploading}
              />
            </BubbleMenu>

            {inTable && editable && (
              <div className="fixed bottom-28 sm:bottom-6 left-1/2 -translate-x-1/2 z-[70] flex max-w-[94vw] items-center gap-1 overflow-x-auto rounded-xl border border-border/10 bg-background/90 px-2 py-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2">
                <span className="px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Table</span>
                <TableBtn onClick={() => editor.chain().focus().addColumnBefore().run()}>← Col</TableBtn>
                <TableBtn onClick={() => editor.chain().focus().addColumnAfter().run()}>Col →</TableBtn>
                <TableBtn onClick={() => editor.chain().focus().addRowBefore().run()}>↑ Row</TableBtn>
                <TableBtn onClick={() => editor.chain().focus().addRowAfter().run()}>Row ↓</TableBtn>
                <div className="mx-1 h-4 w-[1px] bg-foreground/10" />
                <TableBtn onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Header</TableBtn>
                <TableBtn onClick={() => resizeCurrentColumn(editor, -40)}>Width −</TableBtn>
                <TableBtn onClick={() => resizeCurrentColumn(editor, 40)}>Width +</TableBtn>
                <TableBtn onClick={() => editor.chain().focus().mergeOrSplit().run()}>Merge</TableBtn>
                <div className="mx-1 h-4 w-[1px] bg-foreground/10" />
                <TableBtn onClick={() => editor.chain().focus().deleteColumn().run()}>− Col</TableBtn>
                <TableBtn onClick={() => editor.chain().focus().deleteRow().run()}>− Row</TableBtn>
                <button type="button" className="flex items-center rounded px-3 text-xs h-7 text-red-400 transition-colors hover:bg-red-500/20" onPointerDown={(ev) => { ev.preventDefault(); editor.chain().focus().deleteTable().run(); }}>
                  <Trash2 className="mr-1.5 h-3 w-3" /> Delete
                </button>
              </div>
            )}
          </>
        )}
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

            const target = e.target as HTMLElement;

            const mentionTarget = target.closest<HTMLElement>(".continuum-entity-mention, .continuum-note-mention");
            if (mentionTarget) {
              const mentionId = mentionTarget.getAttribute("data-id");
              if (!mentionId) return;
              e.preventDefault();
              if (mentionTarget.classList.contains("continuum-note-mention")) {
                navigate(`/notes/${mentionId}`);
              } else {
                navigate(`/entities/${mentionId}`);
              }
              return;
            }

            const linkTarget = target.closest<HTMLAnchorElement>("a");
            if (linkTarget) {
              const href = linkTarget.getAttribute("href");
              if (!href) return;

              if (href.startsWith("/") || href.startsWith(window.location.origin)) {
                e.preventDefault();
                const path = href.replace(window.location.origin, "");
                navigate(path);
              }
            }
          }}
          className="relative"
        >
          {isDragging && (
            <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-xl z-10 flex items-center justify-center pointer-events-none backdrop-blur-[2px]">
              <div className="text-center">
                <Upload className="w-8 h-8 text-primary mx-auto mb-2 animate-bounce" />
                <p className="text-primary font-medium text-sm">Drop files to upload to vault</p>
              </div>
            </div>
          )}
          <EditorContent editor={editor} />
          <StatusBar editor={editor} />
        </div>
        <FindReplace editor={editor} open={findOpen} onClose={() => setFindOpen(false)} />
        <MobileCommandBar editor={editor} />
      </>
    );
  }
);
TiptapEditor.displayName = "TiptapEditor";

function ToolbarBtn({
  editor, action, active, icon: Icon, label, disabled,
}: { editor: Editor; action: (e: Editor) => void; active: boolean; icon: typeof Bold; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      onMouseDown={(e) => { e.preventDefault(); if (!disabled) action(editor); }}
      disabled={disabled}
      className={`p-1.5 rounded-lg transition-colors ${
        disabled 
          ? "cursor-not-allowed opacity-40" 
          : active 
            ? "bg-primary/20 text-primary" 
            : "text-neutral-400 hover:bg-foreground/10 hover:text-foreground"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}
/** Touch-friendly column resize: nudges the current cell's colwidth. */
function resizeCurrentColumn(editor: Editor, delta: number) {
  const attrs = editor.getAttributes("tableCell");
  const headerAttrs = editor.getAttributes("tableHeader");
  const current = (attrs?.colwidth ?? headerAttrs?.colwidth) as number[] | null | undefined;
  const base = Array.isArray(current) && current.length ? current[0] : 160;
  const next = Math.max(60, Math.min(720, base + delta));
  editor.chain().focus().setCellAttribute("colwidth", [next]).run();
}

function TableBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => { e.preventDefault(); onClick(); }}
      className="h-7 shrink-0 whitespace-nowrap rounded px-2.5 text-xs text-neutral-300 transition-colors hover:bg-foreground/10 hover:text-foreground"
    >
      {children}
    </button>
  );
}
