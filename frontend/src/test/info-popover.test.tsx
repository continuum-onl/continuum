import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { InfoPopover } from "@/components/ui/info-popover";

afterEach(cleanup);

it("shows its description when clicked", async () => {
  render(<InfoPopover description="How this feature works" />);

  fireEvent.click(screen.getByRole("button", { name: "How this feature works" }));

  expect(await screen.findByText("How this feature works")).toBeInTheDocument();
});

it("accepts a custom icon and icon color", () => {
  render(
    <InfoPopover
      description="More details"
      icon={<span data-testid="custom-info-icon">?</span>}
      iconColor="rgb(255, 0, 0)"
    />,
  );

  expect(screen.getByTestId("custom-info-icon")).toBeInTheDocument();
  expect(screen.getByTestId("custom-info-icon").parentElement).toHaveStyle({ color: "rgb(255, 0, 0)" });
});
