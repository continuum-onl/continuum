import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FloatingCreateButton } from "@/components/ui/floating-create-button";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("runs the quick capture on a 700ms mobile long press without creating a note", () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  const onClick = vi.fn();
  const onLongPress = vi.fn();
  render(<FloatingCreateButton label="New note" onClick={onClick} onLongPress={onLongPress} />);

  const button = screen.getByRole("button", { name: "New note" });
  fireEvent.pointerDown(button, { button: 0 });
  const progress = button.querySelector("[data-press-progress]");
  expect(progress).toHaveStyle({ transform: "scaleX(1)", transition: "transform 700ms linear" });
  vi.advanceTimersByTime(699);
  expect(onLongPress).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onLongPress).toHaveBeenCalledOnce();
  fireEvent.pointerUp(button);
  expect(progress).toHaveStyle({ transform: "scaleX(0)", transition: "none" });
  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});

it("keeps the normal create action for a short press and on desktop", () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
  const onClick = vi.fn();
  const onLongPress = vi.fn();
  render(<FloatingCreateButton label="New note" onClick={onClick} onLongPress={onLongPress} />);

  const button = screen.getByRole("button", { name: "New note" });
  fireEvent.pointerDown(button, { button: 0 });
  fireEvent.pointerUp(button);
  fireEvent.click(button);
  vi.advanceTimersByTime(700);
  expect(onClick).toHaveBeenCalledOnce();
  expect(onLongPress).not.toHaveBeenCalled();
});
