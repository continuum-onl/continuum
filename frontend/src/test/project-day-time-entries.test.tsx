import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateEntry: vi.fn().mockResolvedValue(undefined),
  deleteEntryAsync: vi.fn().mockResolvedValue(undefined),
  addTimeAsync: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
  getAllInRange: vi.fn().mockResolvedValue({
    data: [{
      id: "entry-1",
      entityId: "project-1",
      date: "2026-10-18",
      durationSeconds: 5400,
      source: "TIMER",
    }],
  }),
}));

vi.mock("@/lib/api", () => ({ timeTrackingApi: { getAllInRange: mocks.getAllInRange } }));
vi.mock("@/hooks/useTimeTracking", () => ({
  useTimeTracking: () => ({
    updateEntry: mocks.updateEntry,
    deleteEntryAsync: mocks.deleteEntryAsync,
    addTimeAsync: mocks.addTimeAsync,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ language: "en", t: (key: string) => key }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectDayTimeEntries } from "@/components/ProjectDayTimeEntries";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("lets a user edit time entries from a selected project heatmap day", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectDayTimeEntries entityId="project-1" date="2026-10-18" onOpenChange={vi.fn()} />
    </QueryClientProvider>
  );

  expect(await screen.findByText("TIMER")).toBeInTheDocument();
  const input = screen.getByRole("spinbutton", { name: "tm_edit_duration" });
  fireEvent.change(input, { target: { value: "45" } });
  fireEvent.click(screen.getByTitle("tm_save"));

  expect(mocks.getAllInRange).toHaveBeenCalledWith("2026-10-18", "2026-10-18");
  await waitFor(() => expect(mocks.updateEntry).toHaveBeenCalledWith({
    entryId: "entry-1",
    durationSeconds: 2700,
  }));
  await waitFor(() => expect(queryClient.getQueryData<Array<{ durationSeconds: number }>>(
    ["timeTracking", "entries", "project-1", "2026-10-18"],
  )?.[0].durationSeconds).toBe(2700));

  // The day drawer is view/edit/remove only — adding time happens exclusively
  // through the "Add entry" button flow, never from a heatmap cell click.
  expect(screen.queryByRole("button", { name: "tm_add" })).not.toBeInTheDocument();
  expect(mocks.addTimeAsync).not.toHaveBeenCalled();
});

it("spins only the save icon while saving an entry", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let finishUpdate!: () => void;
  mocks.updateEntry.mockImplementationOnce(() => new Promise<void>((resolve) => {
    finishUpdate = resolve;
  }));
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectDayTimeEntries entityId="project-1" date="2026-10-18" onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );

  await screen.findByText("TIMER");
  fireEvent.click(screen.getByRole("button", { name: "tm_save" }));
  await waitFor(() => expect(mocks.updateEntry).toHaveBeenCalled());

  expect(screen.getByRole("button", { name: "tm_save" }).querySelector("svg")).toHaveClass("animate-spin");
  expect(screen.getByRole("button", { name: "tm_delete_entry" }).querySelector("svg")).not.toHaveClass("animate-spin");

  finishUpdate();
  await waitFor(() => expect(screen.getByRole("button", { name: "tm_save" }).querySelector("svg")).not.toHaveClass("animate-spin"));
});

it("removes the selected past-day entry from the list after a successful deletion", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let finishDelete!: () => void;
  mocks.deleteEntryAsync.mockImplementationOnce(() => new Promise<void>((resolve) => {
    finishDelete = resolve;
  }));
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectDayTimeEntries entityId="project-1" date="2026-10-18" onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByText("TIMER");
  fireEvent.click(screen.getByRole("button", { name: "tm_delete_entry" }));
  expect(await screen.findByText("tm_delete_entry_confirm_title")).toBeInTheDocument();
  expect(mocks.deleteEntryAsync).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "common_delete" }));
  await waitFor(() => expect(mocks.deleteEntryAsync).toHaveBeenCalledWith("entry-1"));
  expect(screen.getByRole("button", { name: "tm_delete_entry" }).querySelector("svg")).toHaveClass("animate-spin");
  expect(screen.getByRole("button", { name: "tm_save" }).querySelector("svg")).not.toHaveClass("animate-spin");
  finishDelete();
  await waitFor(() => expect(screen.queryByText("TIMER")).not.toBeInTheDocument());
  expect(queryClient.getQueryData(["timeTracking", "entries", "project-1", "2026-10-18"])).toEqual([]);
});

it("preserves seconds and allows reducing a duration below one minute", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectDayTimeEntries entityId="project-1" date="2026-10-18" onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  const input = await screen.findByRole("spinbutton", { name: "tm_edit_duration" });
  fireEvent.change(input, { target: { value: "0.5" } });
  fireEvent.click(screen.getByTitle("tm_save"));
  await waitFor(() => expect(mocks.updateEntry).toHaveBeenCalledWith({ entryId: "entry-1", durationSeconds: 30 }));
});
