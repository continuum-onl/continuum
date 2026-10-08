import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import { resolveVaultBlob } from "@/lib/vault-blob";
import { Loader2, ImageOff } from "@/lib/heroicons";

export function ResizeBar({ value, onChange }: { value: number; onChange: (w: number) => void }) {
  return (
    <div contentEditable={false} className="mt-2 flex justify-center gap-1">
      {[25, 50, 75, 100].map((w) => (
        <button key={w} type="button" onMouseDown={(e) => { e.preventDefault(); onChange(w); }}
          className={`rounded-md border px-2.5 py-1 text-xs ${value === w ? "border-primary/40 bg-primary/15 text-primary" : "border-border/15 text-muted-foreground hover:text-foreground"}`}>
          {w}%
        </button>
      ))}
    </div>
  );
}

function VaultImageView({ node, editor, selected, updateAttributes }: NodeViewProps) {
  const width: number = node.attrs.width ?? 100;
  const vaultId: string | null = node.attrs.vaultId ?? null;
  const alt: string = node.attrs.alt ?? "";
  const [src, setSrc] = useState<string | null>(node.attrs.src || null);
  const [error, setError] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!vaultId) return;
    setError(false);
    resolveVaultBlob(vaultId)
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [vaultId]);

  return (
    <NodeViewWrapper as="div" className="my-4">
      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <ImageOff className="h-4 w-4" /> Failed to load image
        </div>
      ) : src ? (
        <>
          <img
            src={src}
            alt={alt}
            onClick={() => setLightbox(true)}
            style={{ width: `${width}%` }}
            className="mx-auto block rounded-lg max-w-full h-auto cursor-zoom-in"
            draggable={false}
          />
          {lightbox && (
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm"
              onClick={() => setLightbox(false)}
            >
              <img src={src} alt={alt} className="max-h-[92vh] max-w-[96vw] rounded-lg object-contain" />
              <button
                type="button"
                aria-label="Close image"
                onClick={() => setLightbox(false)}
                className="absolute right-4 top-4 rounded-full border border-border/15 bg-background/60 px-3 py-1 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-border/10 bg-muted/30 px-3 py-6 text-sm text-muted-foreground justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading image…
        </div>
      )}
      {editor.isEditable && selected && src && <ResizeBar value={width} onChange={(w) => updateAttributes({ width: w })} />}
    </NodeViewWrapper>
  );
}

export const VaultImage = Node.create({
  name: "vaultImage",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      vaultId: { default: null },
      alt: { default: null },
      width: { default: 100, parseHTML: (el) => Number((el as HTMLElement).getAttribute("data-width")) || 100 },
      src: { default: null }, // optional fallback for non-vault images
    };
  },

  parseHTML() {
    return [
      {
        tag: "img[data-vault-id]",
        getAttrs: (el) => ({
          vaultId: (el as HTMLElement).getAttribute("data-vault-id"),
          alt: (el as HTMLElement).getAttribute("alt"),
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { vaultId, src, alt, width } = HTMLAttributes as any;
    return [
      "img",
      mergeAttributes(
        { "data-vault-id": vaultId ?? undefined, "data-width": width ?? undefined, alt: alt ?? undefined, src: src ?? undefined },
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VaultImageView);
  },
});
