// SharePanel — "Shareable Assets" section in the AttributePanel.
//
// For published posts: shows 3 story cards (Blanc · Noir · Blanc) populated
// with the top quotes extracted by Gemini. Lets the author export each as a
// full-quality PNG (300 × 534 px base, exported at 4× = 1200 × 2136 px).
//
// For unpublished posts: shows a placeholder.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toPng } from "html-to-image";
import { useSetting } from "@/lib/settings";
import { updatePost } from "@/lib/posts";
import { formatDate } from "@/lib/format";
import { StoryCard } from "@/shareable/StoryCard";
import type { CardData, TemplateId } from "@/shareable/StoryCard";
import type { Post } from "@/types";

// Blanc · Noir · Blanc — alternating light/dark/light
const TEMPLATES: TemplateId[] = [1, 2, 1];

interface Props {
  post: Post;
}

export function SharePanel({ post }: Props) {
  const authorName = useSetting<string>("author.name", "Ghaith Ayadi");
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [openCard, setOpenCard] = useState<number | null>(null);

  // Hidden full-size card refs used for PNG export
  const exportRefs = [
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
  ];

  const quotes = post.shareableQuotes;
  const hasQuotes = Array.isArray(quotes) && quotes.length > 0;

  const date = post.publishedAt ? formatDate(post.publishedAt) : "";

  function cardData(i: number): CardData {
    return {
      quote: quotes?.[i] ?? "",
      title: post.title || "Untitled",
      author: authorName ?? "Ghaith Ayadi",
      date,
      slug: post.slug,
    };
  }

  async function generate() {
    setStatus("generating");
    try {
      const res = await fetch("/api/extract-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: post.id, content: post.content }),
      });
      const data = await res.json() as { quotes?: string[]; error?: string };
      if (!res.ok || !data.quotes) {
        throw new Error(data.error ?? "Extraction failed");
      }
      await updatePost(post.id, { shareableQuotes: data.quotes });
      setStatus("idle");
    } catch (err) {
      console.error("[SharePanel] Quote extraction failed:", err);
      setStatus("error");
    }
  }

  async function exportCard(index: number) {
    const el = exportRefs[index].current;
    if (!el) return;
    try {
      const dataUrl = await toPng(el, {
        pixelRatio: 4,
        width: 300,
        height: 534,
        style: { transform: "none" },
      });
      const link = document.createElement("a");
      link.download = `${post.slug ?? "verbatim"}-card-${index + 1}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("[SharePanel] Export failed:", err);
    }
  }

  async function exportAll() {
    for (let i = 0; i < TEMPLATES.length; i++) {
      await exportCard(i);
    }
  }

  // ── Unpublished ────────────────────────────────────────────────────────────
  if (post.status !== "published") {
    return (
      <SectionWrap>
        <p className="text-xs text-tertiary">Publish the post to generate shareable assets.</p>
      </SectionWrap>
    );
  }

  // ── Published, no quotes yet ───────────────────────────────────────────────
  if (!hasQuotes) {
    return (
      <SectionWrap>
        {status === "error" && (
          <div className="mb-2 space-y-1.5">
            <p className="text-[11px] text-error-primary">
              Couldn't generate assets. Please try again.
            </p>
          </div>
        )}
        <GenerateButton
          loading={status === "generating"}
          retry={status === "error"}
          onClick={() => void generate()}
        />
      </SectionWrap>
    );
  }

  // ── Published, quotes available ────────────────────────────────────────────
  return (
    <SectionWrap>
      {/* Hidden full-size cards used for PNG export */}
      <div aria-hidden style={{ position: "absolute", left: -9999, top: -9999, opacity: 0, pointerEvents: "none" }}>
        {TEMPLATES.map((tid, i) => (
          <div key={i} ref={exportRefs[i]}>
            <StoryCard template={tid} data={cardData(i)} />
          </div>
        ))}
      </div>

      {/* Visible scaled-down previews */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
        {TEMPLATES.map((tid, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
            {/* Card thumbnail: 300×534 scaled to 130×231 — clickable to open preview */}
            <button
              type="button"
              onClick={() => setOpenCard(i)}
              style={{
                width: 130,
                height: 231,
                overflow: "hidden",
                position: "relative",
                borderRadius: 4,
                boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
                flexShrink: 0,
                padding: 0,
                cursor: "pointer",
                border: "none",
                background: "none",
              }}
            >
              <div style={{ transform: "scale(0.433)", transformOrigin: "top left", position: "absolute" }}>
                <StoryCard template={tid} data={cardData(i)} />
              </div>
            </button>

            {/* Export button */}
            <button
              onClick={() => void exportCard(i)}
              className="flex h-6 w-[130px] items-center justify-center rounded border border-secondary bg-primary text-[11px] font-medium text-secondary transition hover:bg-secondary hover:text-primary"
            >
              ↓ Export
            </button>
          </div>
        ))}
      </div>

      {/* Regenerate */}
      <button
        onClick={() => void generate()}
        disabled={status === "generating"}
        className="mt-1 text-[11px] text-quaternary underline-offset-2 transition hover:text-secondary hover:underline disabled:opacity-40"
      >
        {status === "generating" ? "Regenerating…" : "Regenerate"}
      </button>

      {/* Preview dialog */}
      {openCard !== null && (
        <CardPreviewDialog
          index={openCard}
          templates={TEMPLATES}
          cardData={cardData}
          onNavigate={setOpenCard}
          onExport={exportCard}
          onExportAll={() => void exportAll()}
          onClose={() => setOpenCard(null)}
        />
      )}
    </SectionWrap>
  );
}

// ── CardPreviewDialog ──────────────────────────────────────────────────────

interface CardPreviewDialogProps {
  index: number;
  templates: TemplateId[];
  cardData: (i: number) => CardData;
  onNavigate: (i: number) => void;
  onExport: (i: number) => Promise<void>;
  onExportAll: () => void;
  onClose: () => void;
}

function CardPreviewDialog({
  index,
  templates,
  cardData,
  onNavigate,
  onExport,
  onExportAll,
  onClose,
}: CardPreviewDialogProps) {
  const total = templates.length;

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onNavigate((index - 1 + total) % total);
      if (e.key === "ArrowRight") onNavigate((index + 1) % total);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, total, onNavigate, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col items-center gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute -right-10 -top-2 flex size-7 items-center justify-center rounded-full text-white/60 transition hover:text-white"
          aria-label="Close"
        >
          ✕
        </button>

        {/* Card at natural size */}
        <div style={{ width: 300, height: 534, borderRadius: 6, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}>
          <StoryCard template={templates[index]} data={cardData(index)} />
        </div>

        {/* Navigation dots */}
        {total > 1 && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate((index - 1 + total) % total)}
              className="flex size-7 items-center justify-center rounded-full text-white/60 transition hover:text-white"
              aria-label="Previous"
            >
              ‹
            </button>
            <div className="flex gap-1.5">
              {templates.map((_, i) => (
                <button
                  key={i}
                  onClick={() => onNavigate(i)}
                  className={[
                    "size-1.5 rounded-full transition",
                    i === index ? "bg-white" : "bg-white/30 hover:bg-white/60",
                  ].join(" ")}
                  aria-label={`Card ${i + 1}`}
                />
              ))}
            </div>
            <button
              onClick={() => onNavigate((index + 1) % total)}
              className="flex size-7 items-center justify-center rounded-full text-white/60 transition hover:text-white"
              aria-label="Next"
            >
              ›
            </button>
          </div>
        )}

        {/* Download actions */}
        <div className="flex gap-2">
          <button
            onClick={() => void onExport(index)}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-white px-4 text-xs font-medium text-black transition hover:bg-white/90"
          >
            ↓ Download this
          </button>
          <button
            onClick={onExportAll}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-white/20 px-4 text-xs font-medium text-white/80 transition hover:border-white/40 hover:text-white"
          >
            ↓ Download all
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 border-t border-secondary pt-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-quaternary">
        Shareable Assets
      </div>
      {children}
    </div>
  );
}

function GenerateButton({
  loading,
  retry,
  onClick,
}: {
  loading: boolean;
  retry?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-secondary bg-primary text-xs font-medium text-secondary shadow-xs transition hover:bg-secondary hover:text-primary disabled:opacity-50"
    >
      {loading ? (
        <>
          <span className="size-2.5 animate-spin rounded-full border border-current border-t-transparent" />
          Extracting quotes…
        </>
      ) : retry ? (
        "Retry"
      ) : (
        "Generate assets"
      )}
    </button>
  );
}
