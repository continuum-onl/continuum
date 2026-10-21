import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ data: { id: "new-note" } }),
  list: vi.fn().mockResolvedValue({
    data: [{ title: "Untitled #2" }, { title: "Sem título #7" }, { title: "Project notes" }],
  }),
  navigate: vi.fn(),
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  refresh: vi.fn(),
  applyUsageDelta: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ notesApi: { create: mocks.create, list: mocks.list } }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    setQueryData: mocks.setQueryData,
    invalidateQueries: mocks.invalidateQueries,
  }),
}));
vi.mock("@/hooks/usePlanGate", () => ({
  usePlanGate: () => ({
    canCreateNote: true,
    refresh: mocks.refresh,
    applyUsageDelta: mocks.applyUsageDelta,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key === "notes_untitled" ? "Sem título" : key }),
}));

import { useCreateNote } from "@/hooks/useCreateNote";

afterEach(() => {
  vi.clearAllMocks();
});

it("creates an untitled note with the next available number", async () => {
  const { result } = renderHook(() => useCreateNote());

  await act(async () => {
    await result.current.createNote();
  });

  expect(mocks.list).toHaveBeenCalledOnce();
  expect(mocks.create).toHaveBeenCalledWith("sem título #8", "");
  expect(mocks.navigate).toHaveBeenCalledWith("/notes/new-note");
});
