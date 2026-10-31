import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveBox, Check, ChevronRight, Plus, Trash2 } from "@/lib/heroicons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { workspacesApi, type Workspace } from "@/lib/api";
import { setActiveWorkspace, useActiveWorkspace, WORKSPACE_COLORS } from "@/lib/workspace";
import { useWorkspaceText } from "@/lib/workspace-text";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const WORKSPACES_KEY = ["workspaces", "list"] as const;

export function useWorkspaces(enabled = true) {
  return useQuery({
    queryKey: WORKSPACES_KEY,
    queryFn: () => workspacesApi.list().then((r) => r.data ?? []),
    staleTime: 5 * 60_000,
    enabled,
  });
}

function Dot({ color, className }: { color?: string; className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: color }} />;
}

export const MAIN_WORKSPACE = "main";

/** Opens the "new workspace" dialog from anywhere (e.g. the mobile More menu). */
export function openCreateWorkspace() {
  window.dispatchEvent(new Event("continuum:create-workspace"));
}

/** Workspace picker inside the mobile More menu: tapping the header opens a panel
 *  that overlays the whole menu, with its own scrollable list. */
export function WorkspaceSubmenu({ expanded = false, onExpandedChange }: { expanded?: boolean; onExpandedChange?: (v: boolean) => void }) {
  const s = useWorkspaceText();
  const active = useActiveWorkspace();
  const { data: workspaces = [] } = useWorkspaces();
  const items = [
    { id: null as string | null, name: s.all, color: undefined as string | undefined },
    { id: MAIN_WORKSPACE, name: s.main, color: "hsl(var(--muted-foreground))" },
    ...workspaces.map((w) => ({ id: w.id as string | null, name: w.name, color: w.color })),
  ];
  const cur = items.find((i) => i.id === active) ?? items[0];
  return (
    <>
      <DropdownMenuItem
        onSelect={(e) => { e.preventDefault(); onExpandedChange?.(!expanded); }}
        className="gap-2"
      >
        {cur.color ? <Dot color={cur.color} className="mx-[3px]" /> : <ArchiveBox className="h-4 w-4" />}
        <span className="flex-1 truncate">{cur.name}</span>
        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-90")} />
      </DropdownMenuItem>
      {expanded && (
        <div className="absolute inset-0 z-10 flex flex-col overflow-hidden rounded-[inherit] bg-popover">
          <button
            type="button"
            onClick={() => onExpandedChange?.(false)}
            className="flex shrink-0 items-center gap-2 border-b border-border/10 px-3 py-2.5 text-left text-sm"
          >
            <ArchiveBox className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 truncate">{cur.name}</span>
            <span className="text-muted-foreground">‹</span>
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
            {items.map((i) => (
              <DropdownMenuItem key={i.id ?? "all"} onSelect={() => setActiveWorkspace(i.id)} className="gap-2">
                {i.color ? <Dot color={i.color} className="mx-[3px]" /> : <ArchiveBox className="h-4 w-4 text-muted-foreground" />}
                <span className="flex-1 truncate">{i.name}</span>
                {active === i.id && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
            ))}
          </div>
          <div className="shrink-0 border-t border-border/10 p-1">
            <DropdownMenuItem onSelect={() => openCreateWorkspace()} className="gap-2">
              <Plus className="h-4 w-4" /> {s.create}
            </DropdownMenuItem>
          </div>
        </div>
      )}
    </>
  );
}

export function WorkspaceSwitcher({
  compact = false,
  className,
  listenForCreate = false,
  open,
  onOpenChange,
  sidebarPopup = false,
}: {
  compact?: boolean;
  className?: string;
  listenForCreate?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  sidebarPopup?: boolean;
}) {
  const s = useWorkspaceText();
  const active = useActiveWorkspace();
  const { data: workspaces = [], isSuccess } = useWorkspaces();
  const qc = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(WORKSPACE_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null);
  const menuOpen = open ?? internalOpen;
  const handleOpenChange = (nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  useEffect(() => {
    if (!listenForCreate) return;
    const open = () => setCreating(true);
    window.addEventListener("continuum:create-workspace", open);
    return () => window.removeEventListener("continuum:create-workspace", open);
  }, [listenForCreate]);
  const current = active === MAIN_WORKSPACE ? { id: MAIN_WORKSPACE, name: s.main, color: "hsl(var(--muted-foreground))" } as Workspace : workspaces.find((w) => w.id === active);

  // Workspace removed on another device: fall back to "All". Runs as an effect (never
  // during render) and only once the list has actually loaded, so it also recovers
  // when the deleted workspace was the user's last one.
  useEffect(() => {
    if (isSuccess && active && active !== MAIN_WORKSPACE && !workspaces.some((w) => w.id === active)) {
      setActiveWorkspace(null);
    }
  }, [isSuccess, active, workspaces]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const { data } = await workspacesApi.create(trimmed, color);
      qc.setQueryData<Workspace[]>(WORKSPACES_KEY, (prev) => [...(prev ?? []), data]);
      setActiveWorkspace(data.id);
      setCreating(false);
      setName("");
    } catch {
      toast.error(s.error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (w: Workspace) => {
    try {
      await workspacesApi.delete(w.id);
      qc.setQueryData<Workspace[]>(WORKSPACES_KEY, (prev) => (prev ?? []).filter((x) => x.id !== w.id));
      // Items lost a workspace id; refresh lists so "Main" shows them again.
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["graph"] });
      if (active === w.id) setActiveWorkspace(null);
    } catch {
      toast.error(s.error);
    }
  };

  return (
    <>
      <DropdownMenu modal={false} open={menuOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={s.title}
            className={cn(
              "flex items-center gap-2 rounded-full border border-border/10 bg-background/80 text-sm text-foreground backdrop-blur transition-colors hover:bg-foreground/5",
              compact ? "h-9 w-9 justify-center" : "h-9 max-w-[14rem] px-3",
              className,
            )}
          >
            {current ? <Dot color={current.color} /> : <ArchiveBox className="h-4 w-4 text-muted-foreground" />}
            {!compact && <span className="truncate">{current?.name ?? s.all}</span>}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={cn("w-60", sidebarPopup && "border-sidebar-border/10 bg-sidebar/85 text-sidebar-foreground backdrop-blur-xl")}
        >
          <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">{s.title}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setActiveWorkspace(null)} className="gap-2">
            <ArchiveBox className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">{s.all}</span>
            {!active && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setActiveWorkspace(MAIN_WORKSPACE)} className="gap-2">
            <Dot color="hsl(var(--muted-foreground))" className="mx-[3px]" />
            <span className="flex-1">{s.main}</span>
            {active === MAIN_WORKSPACE && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
          {workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => setActiveWorkspace(w.id)} className="group gap-2">
              <Dot color={w.color} className="mx-[3px]" />
              <span className="flex-1 truncate">{w.name}</span>
              {active === w.id && <Check className="h-4 w-4" />}
              <button
                type="button"
                aria-label={s.delete}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleOpenChange(false); setPendingDelete(w); }}
                className="rounded p-0.5 text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {s.create}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{s.create}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            maxLength={60}
            placeholder={s.placeholder}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          />
          <div className="flex gap-2">
            {WORKSPACE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn("h-7 w-7 rounded-full ring-offset-2 ring-offset-background transition", color === c && "ring-2 ring-foreground/60")}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <DialogFooter>
            <Button onClick={create} disabled={busy || !name.trim()}>{s.createButton}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title={pendingDelete ? s.confirmDelete(pendingDelete.name) : ""}
        description={s.confirmDeleteDesc}
        confirmText={s.delete}
        cancelText={s.cancel}
        destructive
        onConfirm={async () => {
          const w = pendingDelete;
          setPendingDelete(null);
          if (w) await remove(w);
        }}
      />
    </>
  );
}

/** Lets a note or entity belong to one or more workspaces. */
export function WorkspaceAssign({
  kind,
  id,
  value,
  onChange,
  presentation = "chips",
}: {
  kind: "NOTE" | "ENTITY";
  id: string;
  value?: string[];
  onChange?: (ids: string[]) => void;
  presentation?: "chips" | "drawer";
}) {
  const s = useWorkspaceText();
  const { data: workspaces = [] } = useWorkspaces();
  const [ids, setIds] = useState<string[]>(value ?? []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const qc = useQueryClient();
  if (workspaces.length === 0 && presentation === "chips") return null;
  // No explicit workspace means the item lives in Main.
  const shown = ids.length === 0 ? [MAIN_WORKSPACE] : ids;
  const chips = [{ id: MAIN_WORKSPACE, name: s.main, color: "hsl(var(--muted-foreground))" } as Workspace, ...workspaces];

  const toggle = async (wsId: string) => {
    let next = shown.includes(wsId) ? shown.filter((x) => x !== wsId) : [...shown, wsId];
    if (next.length === 1 && next[0] === MAIN_WORKSPACE) next = [];
    const prev = ids;
    setIds(next);
    try {
      await workspacesApi.assign(kind, id, next);
      onChange?.(next);
      qc.invalidateQueries({ queryKey: [kind === "NOTE" ? "notes" : "entities"] });
      qc.invalidateQueries({ queryKey: ["graph"] });
    } catch {
      setIds(prev);
      toast.error(s.error);
    }
  };

  if (presentation === "drawer") {
    const assignedNames = chips.filter((workspace) => shown.includes(workspace.id)).map((workspace) => workspace.name);
    return (
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full justify-start gap-4 rounded-xl px-2 text-left hover:bg-secondary/60"
            aria-label={s.title}
          >
            <ArchiveBox className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/80">
              {assignedNames.join(", ")}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </DrawerTrigger>
        <DrawerContent className="max-h-[85vh] gap-0">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-serif">{s.title}</DrawerTitle>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
            {chips.map((workspace) => {
              const selected = shown.includes(workspace.id);
              return (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => void toggle(workspace.id)}
                  aria-pressed={selected}
                  className="flex min-h-12 w-full items-center gap-3 border-b border-border/10 px-2 text-left text-sm transition-colors hover:bg-secondary/60"
                >
                  <Dot color={workspace.color} className={cn(!selected && "opacity-50")} />
                  <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                  {selected && <Check className="h-4 w-4 text-foreground" />}
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((w) => {
        const on = shown.includes(w.id);
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => void toggle(w.id)}
            aria-pressed={on}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
              on ? "border-border/20 bg-foreground/10 text-foreground" : "border-border/10 text-muted-foreground hover:text-foreground",
            )}
          >
            <Dot color={w.color} className={cn(!on && "opacity-50")} />
            {w.name}
          </button>
        );
      })}
    </div>
  );
} 