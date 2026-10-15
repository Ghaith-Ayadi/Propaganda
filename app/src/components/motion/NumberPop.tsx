// A number that rises into place when its value changes (badges, counts).
// The first render does not animate.

import { useRef, type ReactNode } from "react";
import { cx } from "@/utils/cx";

export function NumberPop({ value, children, className }: { value: string | number; children?: ReactNode; className?: string }) {
  const first = useRef(true);
  const animate = !first.current;
  first.current = false;
  return (
    <span key={value} className={cx("inline-block", animate && "ppg-pop", className)}>
      {children ?? value}
    </span>
  );
}
