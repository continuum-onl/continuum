import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { ResizeBar } from "./VaultImage";
import { resolveVaultBlob } from "@/lib/vault-blob";
import { FileText, Loader2, ExternalLink } from "@/lib/heroicons";

/** Renders every PDF page to a canvas (mobile browsers can't show PDFs in iframes). */
export function PdfPages({ src, onError, maxPages, className = "max-h-[600px] overflow-y-auto bg-muted/20" }: { src: string; onError: () => void; maxPages?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let doc: any;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        doc = await pdfjs.getDocument(src).promise;
        const box = ref.current;
        if (!box || cancelled) return;
        box.innerHTML = "";
        const width = box.clientWidth || 600;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= Math.min(doc.numPages, maxPages ?? doc.numPages) && !cancelled; i++) {
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (width / base.width) * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = "100%";
          canvas.style.display = "block";
          box.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
          if (i === 1) setLoading(false);
        }
        setLoading(false);
      } catch {
        if (!cancelled) onError();
      }
    })();
    return () => { cancelled = true; doc?.destroy?.(); };
  }, [src]);
  return (
    <div className={className}>
      {loading && (
        <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
      <div ref={ref} className="flex flex-col gap-2" />
    </div>
  );
}

function VaultPdfView({ node, editor, selected, updateAttributes }: NodeViewProps) {
  const width: number = node.attrs.width ?? 100;
  const vaultId: string | null = node.attrs.vaultId ?? null;
  const fileName: string = node.attrs.fileName ?? "Document.pdf";
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!vaultId) return;
    resolveVaultBlob(vaultId)
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [vaultId]);

  return (
    <NodeViewWrapper as="div" className="my-4">
      <div style={{ width: `${width}%` }} className="mx-auto rounded-xl border border-border/10 bg-muted/30 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/10 bg-card/50">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium truncate">{fileName}</span>
          </div>
          {src && (
            <a href={src} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              Open <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {error ? (
          <div className="p-6 text-sm text-destructive text-center">Failed to load PDF</div>
        ) : src ? (
          <PdfPages src={src} onError={() => setError(true)} />
        ) : (
          <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading PDF…
          </div>
        )}
      </div>
      {editor.isEditable && selected && <ResizeBar value={width} onChange={(w) => updateAttributes({ width: w })} />}
    </NodeViewWrapper>
  );
}

export const VaultPdf = Node.create({
  name: "vaultPdf",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      vaultId: { default: null },
      fileName: { default: null },
      width: { default: 100, parseHTML: (el) => Number((el as HTMLElement).getAttribute("data-width")) || 100 },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-vault-pdf]", getAttrs: (el) => ({
      vaultId: (el as HTMLElement).getAttribute("data-vault-id"),
      fileName: (el as HTMLElement).getAttribute("data-file-name"),
    }) }];
  },

  renderHTML({ HTMLAttributes }) {
    const { vaultId, fileName, width } = HTMLAttributes as any;
    return ["div", mergeAttributes({
      "data-vault-pdf": "true",
      "data-vault-id": vaultId ?? undefined,
      "data-file-name": fileName ?? undefined,
      "data-width": width ?? undefined,
    })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VaultPdfView);
  },
});
