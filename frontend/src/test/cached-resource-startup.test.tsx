import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { useCachedResource } from "@/hooks/useCachedResource";

function CachedList({ fetcher }: { fetcher: () => Promise<string[]> }) {
  const { data } = useCachedResource(["startup", "list"], fetcher, {
    refetchOnMount: "always",
  });
  return <div>{data?.join(", ")}</div>;
}

describe("cached resource startup", () => {
  it("renders local data immediately and applies background refresh results", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["startup", "list"], ["local note"]);

    let resolveFetch!: (value: string[]) => void;
    const fetcher = vi.fn(
      () => new Promise<string[]>((resolve) => { resolveFetch = resolve; }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <CachedList fetcher={fetcher} />
      </QueryClientProvider>,
    );

    expect(screen.getByText("local note")).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    await act(async () => resolveFetch(["updated note"]));
    expect(await screen.findByText("updated note")).toBeInTheDocument();
    queryClient.clear();
  });
});
