import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/lib/query-client";

const mocks = vi.hoisted(() => ({
  notesList: vi.fn(),
  entitiesList: vi.fn(),
  vaultList: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      plan: "FREE",
      maxNotes: 50,
      maxEntities: 20,
      maxVaultSizeMB: 10,
      historyDays: 30,
    },
    loading: false,
  }),
}));
vi.mock("@/lib/api", () => ({
  notesApi: { list: mocks.notesList },
  entitiesApi: { list: mocks.entitiesList },
  vaultApi: { list: mocks.vaultList },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { useUsage, UsageProvider } from "@/contexts/UsageContext";

function UsageOutput() {
  const { usage } = useUsage();
  return <output>{JSON.stringify(usage)}</output>;
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("UsageProvider", () => {
  it("counts API list data instead of treating it as a nested response", async () => {
    mocks.notesList.mockResolvedValue({ data: [{ id: "note-1" }, { id: "note-2" }] });
    mocks.entitiesList.mockResolvedValue({
      data: [{ id: "entity-1", type: "PERSON" }, { id: "entity-2", type: "ACTIVITY" }],
    });
    mocks.vaultList.mockResolvedValue({
      data: [{ size: 1024 * 1024 }, { size: 512 * 1024 }],
    });

    render(
      <UsageProvider>
        <UsageOutput />
      </UsageProvider>,
    );

    expect(await screen.findByText(
      '{"notesCount":2,"entitiesCount":2,"activitiesCount":1,"vaultSizeMB":1.5}',
    )).toBeInTheDocument();
  });
});
