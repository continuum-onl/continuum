import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entries: [] as Array<{ id: string; entityId: string; date: string; durationSeconds: number; source: string }>,
  getAllInRange: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ timeTrackingApi: mocks }));
vi.mock("@/hooks/useTimerGoal", () => ({ useTimerGoal: () => ({ goalMinutes: 60, setGoal: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ language: "en", t: (key: string, values?: Record<string, unknown>) => values?.time ? `${key} ${values.time}` : key }),
}));

import { TimeHeatmap } from "@/components/TimeHeatmap";

beforeEach(() => {
  mocks.entries = [{ id: "entry-1", entityId: "project-1", date: "2026-10-18", durationSeconds: 5400, source: "TIMER" }];
  mocks.getAllInRange.mockImplementation(async (from: string, to: string) => ({
    data: mocks.entries.filter((entry) => entry.date >= from && entry.date <= to).map((entry) => ({ ...entry })),
  }));
  mocks.updateEntry.mockImplementation(async (id: string, durationSeconds: number) => {
    mocks.entries = mocks.entries.map((entry) => entry.id === id ? { ...entry, durationSeconds } : entry);
    return { data: mocks.entries.find((entry) => entry.id === id) };
  });
  mocks.deleteEntry.mockImplementation(async (id: string) => {
    mocks.entries = mocks.entries.filter((entry) => entry.id !== id);
    return { data: null };
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderHeatmap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TimeHeatmap entityId="project-1" /></QueryClientProvider>);
  return client;
}

it("shows the project day editing hint when the info button is clicked", async () => {
  renderHeatmap();
  expect(screen.queryByText("tm_project_day_hint")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "tm_project_day_hint" }));
  expect(await screen.findByText("tm_project_day_hint")).toBeInTheDocument();
});

it("opens a past day and refreshes its total and cell after reducing time", async () => {
  renderHeatmap();
  fireEvent.click(await screen.findByRole("button", { name: "Sunday, October 18, 2026, 1h 30m, 1 tm_entry_plural" }));
  expect(await screen.findByText("tm_total_time_colon 01:30:00")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("spinbutton", { name: "tm_edit_duration" }), { target: { value: "45" } });
  fireEvent.click(screen.getByRole("button", { name: "tm_save" }));
  await waitFor(() => expect(mocks.updateEntry).toHaveBeenCalledWith("entry-1", 2700));
  expect(await screen.findByText("tm_total_time_colon 00:45:00")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Sunday, October 18, 2026, 45m, 1 tm_entry_plural", hidden: true })).toBeInTheDocument());
});

it("opens a past day and removes both its entry and heatmap count", async () => {
  renderHeatmap();
  fireEvent.click(await screen.findByRole("button", { name: "Sunday, October 18, 2026, 1h 30m, 1 tm_entry_plural" }));
  await screen.findByText("TIMER");
  fireEvent.click(screen.getByRole("button", { name: "tm_delete_entry" }));
  expect(await screen.findByText("tm_delete_entry_confirm_title")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "common_delete" }));
  await waitFor(() => expect(mocks.deleteEntry).toHaveBeenCalledWith("entry-1"));
  expect(await screen.findByText("tm_total_time_colon 00:00:00")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("TIMER")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Sunday, October 18, 2026, 0m, 0 tm_entry_plural", hidden: true })).toBeInTheDocument();
});