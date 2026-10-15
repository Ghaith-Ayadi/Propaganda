// A drag handle on the left edge of a right-hand panel. Drag, or focus it and
// use the arrow keys (Shift = bigger steps); double-click resets.

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

export function ResizeHandle({
  width,
  min,
  max,
  onChange,
  onReset,
  label = "Resize panel",
}: {
  width: number;
  min: number;
  max: number;
  onChange: (w: number) => void;
  onReset?: () => void;
  label?: string;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: width };
    document.documentElement.dataset.resizing = "1";
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    // The panel sits on the right: dragging left makes it wider.
    onChange(start.current.w + (start.current.x - e.clientX));
  }
  function end(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    start.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    delete document.documentElement.dataset.resizing;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft") onChange(width + step);
    else if (e.key === "ArrowRight") onChange(width - step);
    else return;
    e.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      className="group absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-none max-md:hidden"
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition group-hover:w-0.5 group-hover:bg-brand-solid group-focus-visible:w-0.5 group-focus-visible:bg-brand-solid group-active:w-0.5 group-active:bg-brand-solid" />
    </div>
  );
}
