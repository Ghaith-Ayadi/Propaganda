import { useEffect, useRef } from "react";
import { navigateTo, homeHref } from "@/blog/route";
import { currentBlogSite } from "@/blog/site";
import { Wordmark } from "./Wordmark";

interface Props {
  backLabel?: string | null;
  onBack?: () => void;
  right?: React.ReactNode;
  /** When true, a reading-progress bar is drawn at the bottom edge of the bar. */
  showProgress?: boolean;
}

/**
 * Single top bar used everywhere on the public site. Wordmark stays
 * centered; left + right slots float on either side. Reading progress
 * (when on a post) is drawn at the bottom edge of the bar — the scroll
 * listener writes the width directly into the DOM via a ref so the
 * indicator updates every animation frame instead of waiting for a
 * React state batch.
 */
export function Topbar({ backLabel, onBack, right, showProgress }: Props) {
  const progressRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showProgress) return;
    let ticking = false;
    const update = () => {
      ticking = false;
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const pct = max > 0 ? Math.min(100, (h.scrollTop / max) * 100) : 0;
      if (progressRef.current) progressRef.current.style.width = `${pct}%`;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [showProgress]);

  return (
    <header className="blog-topbar">
      <div className="blog-topbar__left">
        {backLabel && (
          <button
            type="button"
            className="blog-topbar__back"
            onClick={onBack ?? (() => navigateTo({ view: "home" }))}
          >
            ← {backLabel}
          </button>
        )}
      </div>
      <a
        href={homeHref()}
        onClick={(e) => {
          e.preventDefault();
          navigateTo({ view: "home" });
        }}
        className="blog-topbar__brand"
        aria-label={`${currentBlogSite()?.name ?? "Verbatim"} — home`}
      >
        <Wordmark height={18} />
      </a>
      <div className="blog-topbar__right">{right}</div>
      {showProgress && (
        <div ref={progressRef} className="blog-topbar__progress" style={{ width: "0%" }} />
      )}
    </header>
  );
}
