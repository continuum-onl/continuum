// Keyboard detection that works with or without `interactive-widget=resizes-content`.
// With resizes-content the layout viewport shrinks too, so comparing against the
// live innerHeight reports 0. We compare against the tallest height seen instead.
let baseline = 0;
let baselineWidth = 0;

export function readKeyboard(): { open: boolean; offset: number } {
  const vv = window.visualViewport;
  if (!vv) return { open: false, offset: 0 };
  if (window.innerWidth !== baselineWidth) {
    baselineWidth = window.innerWidth;
    baseline = 0;
  }
  baseline = Math.max(baseline, window.innerHeight, vv.height);
  const occluded = baseline - vv.height - vv.offsetTop;
  const open = occluded > 120;
  // Distance a fixed element must lift to sit above the keyboard.
  const offset = open ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  return { open, offset };
}
