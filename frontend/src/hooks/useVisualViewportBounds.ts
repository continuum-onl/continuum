import { useEffect, useState } from "react";

interface ViewportBounds {
  top: string;
  maxHeight: string;
}

function readViewportBounds(): ViewportBounds {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  const offsetTop = viewport?.offsetTop ?? 0;

  return {
    top: `${offsetTop + height / 2}px`,
    maxHeight: `${Math.max(height - 32, 0)}px`,
  };
}

export function useVisualViewportBounds(enabled = true): ViewportBounds {
  const [bounds, setBounds] = useState<ViewportBounds>(() =>
    typeof window === "undefined"
      ? { top: "50vh", maxHeight: "calc(100dvh - 2rem)" }
      : readViewportBounds(),
  );

  useEffect(() => {
    if (!enabled) return;

    const viewport = window.visualViewport;
    const updateBounds = () => setBounds(readViewportBounds());

    updateBounds();
    viewport?.addEventListener("resize", updateBounds);
    viewport?.addEventListener("scroll", updateBounds);
    window.addEventListener("resize", updateBounds);

    return () => {
      viewport?.removeEventListener("resize", updateBounds);
      viewport?.removeEventListener("scroll", updateBounds);
      window.removeEventListener("resize", updateBounds);
    };
  }, [enabled]);

  return bounds;
}
