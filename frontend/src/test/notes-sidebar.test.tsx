import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const fixtures = vi.hoisted(() => ({
  notes: [{ id: "note-1", title: "Project journal", type: "Journal", createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", favorite: true }],
  types: ["Journal", "Idea"],
}));

vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/useRequireAuth", () => ({ useRequireAuth: () => ({ loading: false }) }));
vi.mock("@/hooks/usePlanGate", () => ({ usePlanGate: () => ({ getLimitMessage: () => "", refresh: vi.fn(), applyUsageDelta: vi.fn() }) }));
vi.mock("@/hooks/useCreateNote", () => ({ useCreateNote: () => ({ createNote: vi.fn(), creating: false }) }));
vi.mock("@/hooks/useCachedResource", () => ({ useCachedResource: (key: string[]) => ({ data: key.includes("types") ? fixtures.types : fixtures.notes, loading: false, setData: vi.fn(), refetch: vi.fn() }) }));
vi.mock("@/lib/query-client", () => ({ queryClient: { invalidateQueries: vi.fn(), getQueryData: vi.fn() } }));
vi.mock("@/components/InsightSignal", () => ({ InsightSignalBadge: () => null }));
vi.mock("@/components/UpgradeModal", () => ({ default: () => null }));
vi.mock("@/components/import/MarkdownImportDialog", () => ({ default: () => null }));
vi.mock("@/components/ui/smooth-drawer", () => ({
  default: ({ open, title, onOpenChange, children }: { open: boolean; title: string; onOpenChange: (open: boolean) => void; children: React.ReactNode }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button type="button" onClick={() => onOpenChange(false)}>Close filters</button>
        {children}
      </div>
    ) : null,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/ui/fit-text", () => ({ FitText: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));

import Notes from "@/pages/Notes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("desktop Notes sidebar", () => {
  it("opens and closes through Others, retaining visibility after choosing filters and clicking elsewhere", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(min-width: 1024px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    render(<MemoryRouter><Notes /></MemoryRouter>);
    const toggle = screen.getByRole("button", { name: "notes_others" });
    expect(screen.queryByRole("button", { name: "notes_filters" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    const sidebar = screen.getByRole("complementary", { name: "notes_filters" });
    expect(sidebar).toHaveTextContent("notes_types");
    expect(sidebar).not.toHaveTextContent("notes_index");
    expect(sidebar).not.toHaveTextContent("notes_recent");
    expect(screen.getByRole("button", { name: "notes_create_type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "notes_delete_type" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "notes_allTypes" }));
    fireEvent.click(screen.getByRole("heading", { name: "notes_title" }));
    expect(sidebar).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});

describe("mobile Notes filter drawer", () => {
  it("opens on horizontal swipes in either direction", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(max-width: 1023px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const { container } = render(<MemoryRouter><Notes /></MemoryRouter>);
    const page = container.querySelector(".relative.min-h-full") as HTMLElement;
    const filterPill = screen.getByRole("button", { name: "notes_archive" });

    fireEvent.touchStart(filterPill, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(filterPill, { changedTouches: [{ clientX: 100, clientY: 105 }] });
    expect(screen.queryByRole("dialog", { name: "notes_filters" })).not.toBeInTheDocument();

    fireEvent.touchStart(page, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(page, { changedTouches: [{ clientX: 100, clientY: 105 }] });
    const drawer = screen.getByRole("dialog", { name: "notes_filters" });
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveTextContent("notes_types");
    expect(drawer).not.toHaveTextContent("notes_index");
    expect(drawer).not.toHaveTextContent("notes_recent");

    fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
    fireEvent.touchStart(page, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(page, { changedTouches: [{ clientX: 200, clientY: 105 }] });
    expect(screen.getByRole("dialog", { name: "notes_filters" })).toBeInTheDocument();
  });
});