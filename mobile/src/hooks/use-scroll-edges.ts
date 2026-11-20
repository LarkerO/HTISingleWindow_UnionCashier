import { useCallback, useRef, useState, type CSSProperties, type RefCallback } from "react";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

// true where more content lies beyond that edge of the scroll container
export type ScrollEdges = { top: boolean; bottom: boolean; left: boolean; right: boolean };

export type ScrollAxis = "x" | "y" | "both";

export type UseScrollEdgesOptions = {
  // the largest fade in px written to --fade-top / --fade-bottom / --fade-left / --fade-right (default 24).
  // each var grows with the distance to its edge, so a fade eases out as you reach the end instead of popping
  fade?: number;
  // distance in px from an edge that still counts as "at the edge" (default 1)
  threshold?: number;
  disabled?: boolean;
};

export type UseScrollEdgesResult<T extends HTMLElement> = {
  // attach to the scrolling element (a plain overflow div, or a Radix ScrollArea viewport)
  ref: RefCallback<T>;
  // which edges have more content beyond them; re-renders only when one flips
  edges: ScrollEdges;
  // whether the content overflows at all on each axis
  overflow: { x: boolean; y: boolean };
};

const NONE: ScrollEdges = { top: false, bottom: false, left: false, right: false };
const NO_OVERFLOW = { x: false, y: false };

// tracks how far a scroll container is from each edge. the fade sizes go straight into css vars on the element
// (no re-render while scrolling); the booleans re-render only when they change, for things like a header hairline
// that appears once the body scrolls or scroll buttons that hide at the ends
export function useScrollEdges<T extends HTMLElement = HTMLDivElement>({
  fade = 24,
  threshold = 1,
  disabled = false,
}: UseScrollEdgesOptions = {}): UseScrollEdgesResult<T> {
  const [edges, setEdges] = useState<ScrollEdges>(NONE);
  const [overflow, setOverflow] = useState(NO_OVERFLOW);
  const last = useRef({ edges: NONE, overflow: NO_OVERFLOW });

  const ref = useCallback<RefCallback<T>>(
    (el) => {
      if (!el || disabled) return;
      let frame = 0;
      // rtl containers report a negative scrollLeft that runs from 0 to -maxX
      const rtl = getComputedStyle(el).direction === "rtl";

      const measure = () => {
        frame = 0;
        const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
        const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
        const y = el.scrollTop;
        const x = Math.abs(el.scrollLeft);
        const start = x;
        const end = Math.max(0, maxX - x);
        const left = rtl ? end : start;
        const right = rtl ? start : end;
        const below = Math.max(0, maxY - y);

        el.style.setProperty("--fade-top", `${Math.min(fade, y)}px`);
        el.style.setProperty("--fade-bottom", `${Math.min(fade, below)}px`);
        el.style.setProperty("--fade-left", `${Math.min(fade, left)}px`);
        el.style.setProperty("--fade-right", `${Math.min(fade, right)}px`);

        const next: ScrollEdges = { top: y > threshold, bottom: below > threshold, left: left > threshold, right: right > threshold };
        const prev = last.current.edges;
        if (next.top !== prev.top || next.bottom !== prev.bottom || next.left !== prev.left || next.right !== prev.right) {
          last.current.edges = next;
          setEdges(next);
        }
        const nextOverflow = { x: maxX > threshold, y: maxY > threshold };
        if (nextOverflow.x !== last.current.overflow.x || nextOverflow.y !== last.current.overflow.y) {
          last.current.overflow = nextOverflow;
          setOverflow(nextOverflow);
        }
      };

      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(measure);
      };

      // content that grows or shrinks (images loading, rows added) moves the edges without a scroll event
      const resize = new ResizeObserver(schedule);
      const observeChildren = () => {
        resize.disconnect();
        resize.observe(el);
        for (const child of Array.from(el.children).slice(0, 64)) resize.observe(child);
      };
      const mutations = new MutationObserver(() => {
        observeChildren();
        schedule();
      });

      observeChildren();
      mutations.observe(el, { childList: true });
      el.addEventListener("scroll", schedule, { passive: true });
      measure();

      return () => {
        cancelAnimationFrame(frame);
        el.removeEventListener("scroll", schedule);
        resize.disconnect();
        mutations.disconnect();
      };
    },
    [fade, threshold, disabled],
  );

  return { ref, edges, overflow };
}

const Y_MASK =
  "linear-gradient(to bottom, transparent, #000 var(--fade-top, 0px), #000 calc(100% - var(--fade-bottom, 0px)), transparent)";
const X_MASK =
  "linear-gradient(to right, transparent, #000 var(--fade-left, 0px), #000 calc(100% - var(--fade-right, 0px)), transparent)";

// a mask that fades the content out toward each edge with more to scroll, driven by the vars useScrollEdges writes.
// spread it into the style of the same element: style={fadeMaskStyle("y")}
export function fadeMaskStyle(axis: ScrollAxis = "y"): CSSProperties {
  if (axis === "both") {
    const image = `${Y_MASK}, ${X_MASK}`;
    return { maskImage: image, WebkitMaskImage: image, maskComposite: "intersect", WebkitMaskComposite: "source-in" };
  }
  const image = axis === "x" ? X_MASK : Y_MASK;
  return { maskImage: image, WebkitMaskImage: image };
}
