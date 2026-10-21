import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ children, activeSnapPoint, setActiveSnapPoint, snapPoints }: { children: React.ReactNode; activeSnapPoint?: number | string | null; setActiveSnapPoint?: (value: number) => void; snapPoints?: number[] }) => (
    <div data-testid="drawer" data-snap={activeSnapPoint} data-points={snapPoints?.join(",")}>
      <button onClick={() => setActiveSnapPoint?.(0.92)}>Expand</button>
      {children}
    </div>
  ),
  DrawerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DrawerDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

import SmoothDrawer from "@/components/ui/smooth-drawer";

afterEach(cleanup);

describe("SmoothDrawer snap behavior", () => {
  it("starts compact, expands, and resets when reopened", () => {
    const props = { expandable: true, onOpenChange: vi.fn(), title: "Node details", children: "Details" };
    const { rerender } = render(<SmoothDrawer {...props} open />);
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-snap", "0.32");
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-points", "0.32,0.92");
    fireEvent.click(screen.getByText("Expand"));
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-snap", "0.92");
    rerender(<SmoothDrawer {...props} open={false} />);
    rerender(<SmoothDrawer {...props} open />);
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-snap", "0.32");
  });

  it("keeps existing drawers content-sized unless expansion is requested", () => {
    render(<SmoothDrawer open onOpenChange={vi.fn()} title="Filters">Filters</SmoothDrawer>);
    expect(screen.getByTestId("drawer")).not.toHaveAttribute("data-points");
  });

  it("expands from an upward swipe on the content when enabled", () => {
    render(
      <SmoothDrawer expandable dragFromContent open onOpenChange={vi.fn()} title="Node details">
        Details
      </SmoothDrawer>,
    );
    const content = screen.getByText("Details");
    const start = new Event("touchstart", { bubbles: true });
    Object.defineProperty(start, "touches", { value: [{ clientY: 100 }] });
    fireEvent(content, start);
    const move = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(move, "touches", { value: [{ clientY: 80 }] });
    fireEvent(content, move);
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-snap", "0.92");
  });
});