import { beforeEach, describe, expect, it, vi } from "vitest";

const axiosMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
}));

vi.mock("axios", () => ({
  default: {
    create: () => axiosMock,
    post: axiosMock.post,
  },
}));

import { entitiesApi } from "@/lib/api";

describe("entitiesApi.list pagination", () => {
  beforeEach(() => axiosMock.get.mockReset());

  it("collects every page and returns the existing flat-list response shape", async () => {
    axiosMock.get
      .mockResolvedValueOnce({
        data: { content: [{ id: "e1" }, { id: "e2" }], totalPages: 3 },
      })
      .mockResolvedValueOnce({
        data: { content: [{ id: "e3" }], totalPages: 3 },
      })
      .mockResolvedValueOnce({
        data: { content: [{ id: "e4" }], totalPages: 3 },
      });

    const result = await entitiesApi.list({ size: 2 });

    expect(result.data).toEqual([{ id: "e1" }, { id: "e2" }, { id: "e3" }, { id: "e4" }]);
    expect(axiosMock.get.mock.calls.map(([, config]) => config.params.page)).toEqual([0, 1, 2]);
    expect(axiosMock.get).toHaveBeenCalledTimes(3);
  });

  it("continues full array pages until the final partial page", async () => {
    axiosMock.get
      .mockResolvedValueOnce({ data: [{ id: "e1" }, { id: "e2" }] })
      .mockResolvedValueOnce({ data: [{ id: "e3" }] });

    const result = await entitiesApi.list({ size: 2 });

    expect(result.data).toEqual([{ id: "e1" }, { id: "e2" }, { id: "e3" }]);
    expect(axiosMock.get.mock.calls.map(([, config]) => config.params.page)).toEqual([0, 1]);
  });
});
