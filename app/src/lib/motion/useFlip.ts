// FLIP for a list: when children move (a card changes column, a row above is
// deleted), they slide from their old position instead of jumping.
// Give each moving element `data-flip="<stable id>"` and call
// `useFlip(containerRef, dep)` where dep changes whenever the list does.

import { useLayoutEffect, useRef, type RefObject } from "react";

export function useFlip(container: RefObject<HTMLElement | null>, dep: unknown): void {
  const prev = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, DOMRect>();
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const id = el.dataset.flip!;
      const rect = el.getBoundingClientRect();
      next.set(id, rect);
      const was = prev.current.get(id);
      if (!was || reduce || typeof el.animate !== "function") return;
      const dx = was.left - rect.left;
      const dy = was.top - rect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: 300, easing: "cubic-bezier(0.3, 0.8, 0.2, 1)" },
      );
    });
    prev.current = next;
  }, [dep]); // eslint-disable-line react-hooks/exhaustive-deps
}
