// The icon for a typed object: what a flag, pitch or review is about. A blog
// post is a book, a newsletter issue is mail, a social post wears its
// network's mark. Untitled UI has no brand logos, so the two marks are inline.

import { BookOpen01, Mail01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";

export type ObjectKind = "blog" | "newsletter" | "linkedin" | "x";

export const objectLabel: Record<ObjectKind, string> = {
  blog: "Blog post",
  newsletter: "Newsletter",
  linkedin: "LinkedIn post",
  x: "X post",
};

export function ObjectIcon({ kind, className }: { kind: ObjectKind; className?: string }) {
  const size = cx("size-5 shrink-0", className);
  if (kind === "blog") return <BookOpen01 className={cx(size, "text-fg-quaternary")} aria-label={objectLabel.blog} />;
  if (kind === "newsletter") return <Mail01 className={cx(size, "text-fg-quaternary")} aria-label={objectLabel.newsletter} />;
  if (kind === "linkedin") {
    return (
      <svg viewBox="0 0 20 20" className={size} role="img" aria-label={objectLabel.linkedin}>
        <rect width="20" height="20" rx="3" fill="#0A66C2" />
        <path
          fill="#fff"
          d="M5.3 8h2v6.6h-2V8Zm1-3.2a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3ZM8.6 8h1.9v.9h.03c.27-.5.92-1.04 1.9-1.04 2.03 0 2.4 1.33 2.4 3.07v3.67h-2v-3.25c0-.78-.01-1.78-1.08-1.78-1.09 0-1.25.85-1.25 1.72v3.31h-1.9V8Z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className={size} role="img" aria-label={objectLabel.x}>
      <rect width="20" height="20" rx="3" className="fill-[#0f0f0f] dark:fill-white" />
      <path
        className="fill-white dark:fill-[#0f0f0f]"
        d="M11.06 9.18 14.97 4.7h-.93l-3.4 3.89L7.93 4.7H4.8l4.1 5.95-4.1 4.65h.93l3.58-4.07 2.86 4.07h3.13l-4.24-6.12Zm-1.27 1.44-.41-.59-3.3-4.66h1.42l2.67 3.77.41.59 3.47 4.9h-1.42l-2.84-4.01Z"
      />
    </svg>
  );
}
