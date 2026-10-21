import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import SmoothDrawer from "@/components/ui/smooth-drawer";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { importApi, vaultApi } from "@/lib/api";
import { ArrowPathIcon, ArrowUpTrayIcon, CheckCircleIcon, DocumentTextIcon } from "@heroicons/react/24/outline";

type Step = "upload" | "review" | "result";
type EntityType = "PERSON" | "PROJECT" | "TOPIC" | "ORGANIZATION" | "ACTIVITY";

interface PreviewFile {
  filename: string;
  title: string;
  content: unknown;
  candidateKeys: string[];
  wordCount: number;
  assetReferences: string[];
  lastModified: number | null;
}
interface PreviewCandidate {
  key: string;
  name: string;
  suggestedType: EntityType;
  occurrences: number;
  existing: boolean;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
}
interface PreviewResponse {
  files: PreviewFile[];
  candidates: PreviewCandidate[];
  errors: string[];
  skipped?: string[];
}
interface CommitResponse {
  notesCreated: number;
  entitiesCreated: number;
  entitiesReused: number;
  linksCreated: number;
  errors: string[];
}

const TYPES: EntityType[] = ["PERSON", "PROJECT", "TOPIC", "ORGANIZATION", "ACTIVITY"];
const BLOCKED_EXTENSION_BEFORE_MD = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|heic|mp3|wav|m4a|ogg|opus|flac|aac|mp4|mov|webm|avi|mkv|pdf|docx?|xlsx?|pptx?|csv|tsv|zip|rar|7z|tar|gz|exe|dmg|apk|html?|css|js|ts|tsx|jsx|json|xml|yaml|yml)$/i;
const BINARY_MIME = /^(audio|video|image)\//i;
const SUPPORTED_VAULT_FILE = /\.(jpe?g|png|webp|pdf|mp3|m4a)$/i;

/* Shared visual tokens — same rounded language used by the other drawers. */
const fieldClass =
  "h-12 w-full rounded-xl border border-border/15 bg-foreground/[0.03] px-4 text-base text-foreground placeholder:text-muted-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring";
const selectClass =
  "h-12 rounded-xl border border-border/15 bg-foreground/[0.03] px-3.5 text-base text-foreground/90 transition-colors focus:outline-none focus:ring-2 focus:ring-ring";

/* With the drawer's own keyboard repositioning off, keep the focused field in view. */
const revealOnFocus = (e: FocusEvent<HTMLElement>) => {
  const el = e.currentTarget;
  window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
};
const optionClass = "bg-[hsl(var(--popup-background))] text-[hsl(var(--popup-foreground))]";
const panelClass = "rounded-2xl border border-border/10 bg-foreground/[0.03]";

const uploadPath = (file: File) =>
  (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

const isStrictMarkdownFile = (file: File) => {
  const path = uploadPath(file).replace(/\\/g, "/");
  const parts = path.split("/").filter(Boolean);
  const base = parts[parts.length - 1] ?? file.name;
  if (!base || parts.some((part) => part.startsWith("."))) return false;
  if (!/^[^/\\]+\.md$/i.test(base)) return false;
  const stem = base.slice(0, -3);
  if (BLOCKED_EXTENSION_BEFORE_MD.test(stem)) return false;
  if (file.type && BINARY_MIME.test(file.type)) return false;
  return true;
};

const isSupportedVaultFile = (file: File) => SUPPORTED_VAULT_FILE.test(file.name);

const normalizeRelativePath = (path: string) => {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
};

const assetMatchKey = (path: string) =>
  normalizeRelativePath(path).normalize("NFC").toLowerCase();

const resolveAssetFile = (notePath: string, reference: string, files: File[]) => {
  let decodedReference: string;
  try {
    decodedReference = decodeURIComponent(reference);
  } catch {
    return null;
  }
  const path = decodedReference.split(/[?#]/, 1)[0];
  if (!path || path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;

  const noteDirectory = notePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  const expected = normalizeRelativePath(`${noteDirectory}/${path}`);
  const exactMatches = files.filter((file) => assetMatchKey(uploadPath(file)) === assetMatchKey(expected));
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return null;

  const basename = path.split("/").pop();
  const basenameMatches = files.filter((file) => assetMatchKey(file.name) === assetMatchKey(basename ?? ""));
  return basenameMatches.length === 1 ? basenameMatches[0] : null;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const tiptapPlainText = (node: unknown): string => {
  if (!node || typeof node !== "object") return "";
  const record = node as { type?: string; text?: string; attrs?: { label?: string }; content?: unknown[] };
  if (record.type === "text") return record.text ?? "";
  if (record.type === "mention") return record.attrs?.label ?? "";
  return Array.isArray(record.content) ? record.content.map(tiptapPlainText).join(" ") : "";
};

const normalizeSearchText = (value: string) =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const textContainsEntity = (plainText: string, name: string) => {
  const normalizedText = normalizeSearchText(plainText);
  const normalizedName = normalizeSearchText(name);
  if (!normalizedName) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedName)}($|[^\\p{L}\\p{N}])`, "u").test(normalizedText);
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported?: () => void;
}

export default function MarkdownImportDialog({ open, onOpenChange, onImported }: Props) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  // True from the tap on "select files/folder" until the browser hands us the files
  // (or the picker is cancelled). Listing a big folder can take seconds with no feedback.
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [assetFiles, setAssetFiles] = useState<File[]>([]);
  const [decisions, setDecisions] = useState<Record<string, { accept: boolean; type: EntityType; name: string }>>({});
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [customEntities, setCustomEntities] = useState<{ name: string; type: EntityType; matches: number }[]>([]);
  const [customDraftName, setCustomDraftName] = useState("");
  const [customDraftType, setCustomDraftType] = useState<EntityType>("PERSON");

  const reset = useCallback(() => {
    setStep("upload");
    setPreview(null);
    setAssetFiles([]);
    setDecisions({});
    setResult(null);
    setProgress(0);
    setBusy(false);
    setPicking(false);
    setDragging(false);
    setCustomEntities([]);
    setCustomDraftName("");
    setCustomDraftType("PERSON");
  }, []);

  const handleFiles = useCallback(
    async (fileList: ArrayLike<File> | null) => {
      setPicking(false);
      if (!fileList || fileList.length === 0) {
        setProgress(0);
        return;
      }
      // Optimistic: show the loading line right away, then let the browser paint it
      // before we chew through a potentially huge file list.
      setBusy(true);
      setProgress((p) => Math.max(p, 12));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const all = Array.from(fileList);
      const files = all.filter(isStrictMarkdownFile);
      const assets = all.filter(isSupportedVaultFile);
      const skipped = all.length - files.length - assets.length;
      if (files.length === 0) {
        toast({
          title: t("import_noMdTitle"),
          description: t("import_noMdDesc"),
          variant: "destructive",
        });
        setBusy(false);
        setProgress(0);
        return;
      }
      setAssetFiles(assets);
      if (skipped > 0) {
        toast({
          title: t(skipped === 1 ? "import_skippedTitle_one" : "import_skippedTitle", { n: skipped }),
          description: t("import_skippedDesc"),
        });
      }
      try {
        const res = await importApi.previewMarkdown(files);
        setProgress(90);
        const data = res.data as PreviewResponse;
        if (data.files.length === 0) {
          toast({
            title: t("import_noImportableTitle"),
            description: t("import_noImportableDesc"),
            variant: "destructive",
          });
          return;
        }
        setPreview(data);
        const initial: Record<string, { accept: boolean; type: EntityType; name: string }> = {};
        for (const c of data.candidates) {
          initial[c.key] = {
            // Auto-accept anything the AI or wiki-links/frontmatter surfaced.
            // LOW = pure capitalisation heuristic → user opts in manually.
            accept: c.existing || c.confidence === "HIGH" || c.confidence === "MEDIUM",
            type: c.suggestedType,
            name: c.name,
          };
        }
        setDecisions(initial);
        setStep("review");
      } catch (e: any) {
        toast({
          title: t("import_failedTitle"),
          description: e?.response?.data?.message || e?.message || t("import_parseFailedDesc"),
          variant: "destructive",
        });
      } finally {
        setBusy(false);
        setProgress(0);
      }
    },
    [toast, t]
  );

  const handleCommit = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setProgress(20);
    try {
      const referencedAssets = preview.files.flatMap((file) =>
        (file.assetReferences ?? []).flatMap((reference) => {
          const asset = resolveAssetFile(file.filename, reference, assetFiles);
          return asset ? [{ asset }] : [];
        })
      );
      const uniqueAssets = Array.from(new Set(referencedAssets.map(({ asset }) => asset)));
      const uploadedAssets = new Map<File, { id: string }>();
      for (let i = 0; i < uniqueAssets.length; i++) {
        const form = new FormData();
        const assetName = uniqueAssets[i].name.replace(/\\/g, "/").split("/").pop() || uniqueAssets[i].name;
        form.append("file", uniqueAssets[i], assetName);
        const response = await vaultApi.upload(form);
        uploadedAssets.set(uniqueAssets[i], response.data as { id: string });
        setProgress(25 + Math.round(((i + 1) / uniqueAssets.length) * 30));
      }
      const payload = {
        files: preview.files.map((f) => ({
          filename: f.filename,
          title: f.title,
          content: f.content,
          candidateKeys: f.candidateKeys,
          lastModified: f.lastModified,
          assets: (f.assetReferences ?? []).flatMap((reference) => {
            const asset = resolveAssetFile(f.filename, reference, assetFiles);
            const uploaded = asset ? uploadedAssets.get(asset) : undefined;
            return [{ reference, fileId: uploaded?.id ?? "" }];
          }),
        })),
        entities: preview.candidates.map((c) => {
          const d = decisions[c.key];
          return {
            key: c.key,
            name: d?.name ?? c.name,
            type: d?.type ?? c.suggestedType,
            accept: d?.accept ?? false,
          };
        }),
        customEntities: customEntities.map((c) => ({ name: c.name, type: c.type })),
      };
      setProgress(60);
      const res = await importApi.commitMarkdown(payload);
      setResult(res.data as CommitResponse);
      setProgress(100);
      setStep("result");
      onImported?.();
    } catch (e: any) {
      toast({
        title: t("import_failedTitle"),
        description: e?.response?.data?.message || e?.message || t("import_commitFailedDesc"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, [preview, assetFiles, decisions, customEntities, onImported, toast, t]);

  const handleRelink = useCallback(async () => {
    setBusy(true);
    try {
      const res = await importApi.relinkEntities();
      const data = res.data as { notesUpdated: number; connectionsCreated: number };
      toast({
        title: t("import_relinkDoneTitle"),
        description: t("import_relinkDoneDesc", {
          n: data.connectionsCreated,
          notes: data.notesUpdated,
        }),
        variant: data.connectionsCreated > 0 ? "default" : "info",
        notificationCategory: "entity-relink",
      });
      onImported?.();
    } catch (e: any) {
      toast({
        title: t("import_failedTitle"),
        description: e?.response?.data?.message || e?.message || t("import_commitFailedDesc"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, [onImported, toast, t]);

  const addCustomEntity = useCallback(() => {
    const name = customDraftName.trim();
    if (!name) return;
    if (BLOCKED_EXTENSION_BEFORE_MD.test(name) || name.includes("/") || name.includes("\\")) {
      toast({
        title: t("import_invalidNameTitle"),
        description: t("import_invalidNameDesc"),
        variant: "destructive",
      });
      return;
    }
    const matches = preview?.files.filter((file) => textContainsEntity(tiptapPlainText(file.content), name)).length ?? 0;
    if (matches === 0) {
      toast({
        title: t("import_notFoundTitle"),
        description: t("import_notFoundDesc"),
        variant: "destructive",
      });
      return;
    }
    const key = name.toLowerCase();
    setCustomEntities((s) =>
      s.some((c) => c.name.toLowerCase() === key) ? s : [...s, { name, type: customDraftType, matches }]
    );
    setCustomDraftName("");
  }, [customDraftName, customDraftType, preview, toast, t]);

  const acceptedCount = useMemo(
    () => Object.values(decisions).filter((d) => d.accept).length,
    [decisions]
  );

  const loading = busy || picking;

  // Keep the loading line moving while we wait, so it never looks frozen.
  useEffect(() => {
    if (!loading || step === "result") return;
    const id = window.setInterval(() => {
      setProgress((p) => (p < 85 ? p + Math.max(0.5, (85 - p) * 0.06) : p));
    }, 250);
    return () => window.clearInterval(id);
  }, [loading, step]);

  // Safety net for browsers that never fire the file input's "cancel" event.
  useEffect(() => {
    if (!picking) return;
    const id = window.setTimeout(() => {
      setPicking(false);
      setProgress(0);
    }, 60_000);
    return () => window.clearTimeout(id);
  }, [picking]);

  const handlePickerCancel = useCallback(() => {
    setPicking(false);
    setProgress(0);
  }, []);

  const bindFileInput = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (el) el.oncancel = handlePickerCancel;
    },
    [handlePickerCancel]
  );

  const bindFolderInput = useCallback(
    (el: HTMLInputElement | null) => {
      folderInputRef.current = el;
      if (el) el.oncancel = handlePickerCancel;
    },
    [handlePickerCancel]
  );

  const openPicker = useCallback((input: HTMLInputElement | null) => {
    if (!input) return;
    // Instant feedback on tap — the browser can take seconds to list a large folder.
    setPicking(true);
    setProgress((p) => Math.max(p, 6));
    input.click();
  }, []);

  return (
    <SmoothDrawer
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
      title={t("profile_importMd")}
      description={t("import_headerDesc")}
      className="max-w-3xl"
      repositionInputs={false}
    >
      <div className="px-5 pb-5 pt-3 sm:px-6">
        {step === "upload" && (
          <div className="space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFiles(e.dataTransfer.files);
              }}
              className={
                "rounded-3xl border-2 border-dashed px-5 py-9 text-center transition-colors sm:px-10 sm:py-12 " +
                (dragging
                  ? "border-foreground/40 bg-foreground/[0.06]"
                  : "border-border/15 bg-foreground/[0.02] hover:border-foreground/25")
              }
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
                <ArrowUpTrayIcon className="h-6 w-6 text-foreground/80" />
              </div>
              <p className="mt-4 font-serif text-lg text-foreground">{t("import_dropHere")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("import_orPick")}</p>
              <div className="mt-6 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
                <Button
                  onClick={() => openPicker(inputRef.current)}
                  disabled={loading}
                  className="h-11 w-full rounded-xl px-5 text-sm sm:w-auto"
                >
                  {t("import_selectFiles")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => openPicker(folderInputRef.current)}
                  disabled={loading}
                  className="h-11 w-full rounded-xl px-5 text-sm sm:w-auto"
                >
                  {t("import_selectFolder")}
                </Button>
              </div>
              <input
                ref={bindFileInput}
                type="file"
                accept=".md,.jpg,.jpeg,.png,.webp,.pdf,.mp3,.m4a"
                multiple
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = ""; // lets the same selection fire onChange again
                  handleFiles(picked);
                }}
              />
              <input
                ref={bindFolderInput}
                type="file"
                /* @ts-expect-error non-standard */
                webkitdirectory=""
                directory=""
                accept=".md,.jpg,.jpeg,.png,.webp,.pdf,.mp3,.m4a"
                multiple
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = ""; // lets the same selection fire onChange again
                  handleFiles(picked);
                }}
              />
            </div>
            {loading && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t("import_parsing")}</p>
                <Progress value={progress} className="h-1.5 rounded-full bg-secondary" />
              </div>
            )}
            <p className="px-1 text-center text-xs leading-relaxed text-muted-foreground/80">{t("import_limits")}</p>
          </div>
        )}

        {step === "review" && preview && (
          <div className="space-y-6">
            <dl className="grid grid-cols-3 gap-2.5 sm:gap-3">
              <Stat label={t("import_stat_files")} value={preview.files.length} />
              <Stat label={t("import_stat_candidates")} value={preview.candidates.length} />
              <Stat label={t("import_stat_accepted")} value={acceptedCount} />
            </dl>

            <section className="space-y-3">
              <h3 className="font-serif text-lg text-foreground">{t("import_stat_files")}</h3>
              <ul className={`${panelClass} max-h-44 divide-y divide-border/10 overflow-y-auto`}>
                {preview.files.map((f) => (
                  <li key={f.filename} className="flex items-center gap-3 px-3.5 py-2.5 text-sm text-foreground/90">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                      <DocumentTextIcon className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{f.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{f.wordCount} w</span>
                  </li>
                ))}
              </ul>
              {preview.skipped && preview.skipped.length > 0 && (
                <p className="px-1 text-xs text-muted-foreground">
                  {t(preview.skipped.length === 1 ? "import_skippedCount_one" : "import_skippedCount", { n: preview.skipped.length })}
                </p>
              )}
            </section>

            <section className="space-y-3">
              <div className="space-y-1">
                <h3 className="font-serif text-lg text-foreground">{t("import_addOwnTitle")}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{t("import_addOwnDesc")}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={customDraftName}
                  onChange={(e) => setCustomDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomEntity();
                    }
                  }}
                  onFocus={revealOnFocus}
                  placeholder={t("import_addOwnPlaceholder")}
                  className={`${fieldClass} min-w-0 sm:flex-1`}
                />
                <div className="flex gap-2">
                  <select
                    value={customDraftType}
                    onChange={(e) => setCustomDraftType(e.target.value as EntityType)}
                    className={`${selectClass} flex-1 sm:flex-none`}
                  >
                    {TYPES.map((opt) => (
                      <option key={opt} value={opt} className={optionClass}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    onClick={addCustomEntity}
                    disabled={busy || !customDraftName.trim()}
                    className="h-12 rounded-xl px-6 text-sm"
                  >
                    {t("import_addBtn")}
                  </Button>
                </div>
              </div>
              {customEntities.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {customEntities.map((c, i) => (
                    <li
                      key={`${c.name}-${i}`}
                      className="flex items-center gap-2 rounded-full bg-secondary py-1.5 pl-3.5 pr-1.5"
                    >
                      <span className="text-sm text-foreground/90">{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.type}</span>
                      <span className="text-xs text-muted-foreground/80">
                        {t(c.matches === 1 ? "import_matchesCount_one" : "import_matchesCount", { n: c.matches })}
                      </span>
                      <button
                        type="button"
                        aria-label={t("import_removeEntity", { name: c.name })}
                        onClick={() => setCustomEntities((s) => s.filter((_, idx) => idx !== i))}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="font-serif text-lg text-foreground">{t("import_detectedTitle")}</h3>
              {preview.candidates.length === 0 ? (
                <p className={`${panelClass} px-4 py-5 text-center text-sm text-muted-foreground`}>
                  {t("import_noCandidates")}
                </p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-y-auto">
                  {preview.candidates.map((c) => {
                    const d = decisions[c.key] ?? { accept: false, type: c.suggestedType, name: c.name };
                    return (
                      <li key={c.key} className={`${panelClass} p-3`}>
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={d.accept}
                            onChange={(e) =>
                              setDecisions((s) => ({ ...s, [c.key]: { ...d, accept: e.target.checked } }))
                            }
                            className="h-5 w-5 shrink-0 rounded-md accent-foreground"
                            disabled={c.existing}
                          />
                          <input
                            type="text"
                            value={d.name}
                            onChange={(e) =>
                              setDecisions((s) => ({ ...s, [c.key]: { ...d, name: e.target.value } }))
                            }
                            onFocus={revealOnFocus}
                            className="h-9 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-base text-foreground transition-colors hover:bg-foreground/[0.04] focus:bg-foreground/[0.06] focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {c.existing ? t("import_exists") : `${c.occurrences}×`}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2 pl-8">
                          <select
                            value={d.type}
                            onChange={(e) =>
                              setDecisions((s) => ({ ...s, [c.key]: { ...d, type: e.target.value as EntityType } }))
                            }
                            className="h-8 rounded-lg border border-border/15 bg-foreground/[0.03] px-2.5 text-xs text-foreground/90 focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            {TYPES.map((opt) => (
                              <option key={opt} value={opt} className={optionClass}>
                                {opt}
                              </option>
                            ))}
                          </select>
                          {c.confidence && (
                            <span
                              className={
                                "cx-badge rounded-full " +
                                (c.confidence === "HIGH"
                                  ? "cx-badge-success"
                                  : c.confidence === "MEDIUM"
                                  ? "cx-badge-info"
                                  : "cx-badge-neutral")
                              }
                            >
                              {c.confidence}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {preview.errors.length > 0 && (
              <div className="space-y-1 rounded-2xl border border-warning/20 bg-warning/5 p-4 text-sm text-warning">
                {preview.errors.slice(0, 5).map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </div>
            )}

            {busy && <Progress value={progress} className="h-1.5 rounded-full bg-secondary" />}

            <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-2 bg-background/90 px-5 pb-1 pt-3 backdrop-blur-md sm:-mx-6 sm:flex-row sm:justify-end sm:px-6">
              <Button
                variant="secondary"
                onClick={reset}
                disabled={busy}
                className="h-12 w-full rounded-xl text-sm sm:w-auto sm:px-6"
              >
                {t("common_back")}
              </Button>
              <Button
                onClick={handleCommit}
                disabled={busy}
                className="h-12 w-full rounded-xl text-sm sm:w-auto sm:px-6"
              >
                {busy && <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />}
                {t(preview.files.length === 1 ? "import_commitBtn_one" : "import_commitBtn", { n: preview.files.length })}
              </Button>
            </div>
          </div>
        )}

        {step === "result" && result && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-success/15">
                <CheckCircleIcon className="h-7 w-7 text-success" />
              </span>
              <div>
                <p className="font-serif text-xl text-foreground">{t("import_completeTitle")}</p>
                <p className="text-sm text-muted-foreground">{t("import_completeDesc")}</p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
              <Stat label={t("import_stat_notes")} value={result.notesCreated} />
              <Stat label={t("import_stat_newEntities")} value={result.entitiesCreated} />
              <Stat label={t("import_stat_reused")} value={result.entitiesReused} />
              <Stat label={t("import_stat_links")} value={result.linksCreated} />
            </dl>
            {result.errors.length > 0 && (
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-2xl border border-warning/20 bg-warning/5 p-4 text-sm text-warning">
                {result.errors.map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </div>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                onClick={handleRelink}
                disabled={busy}
                className="h-12 w-full rounded-xl text-sm sm:w-auto sm:px-6"
              >
                {busy && <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />}
                {t("import_relinkBtn")}
              </Button>
              <Button
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
                className="h-12 w-full rounded-xl text-sm sm:w-auto sm:px-6"
              >
                {t("import_doneBtn")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </SmoothDrawer>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-foreground/[0.04] px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-serif text-2xl tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
