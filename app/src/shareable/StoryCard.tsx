import "./StoryCard.css";

export interface CardData {
  quote: string;
  title: string;
  author: string;
  date: string;
  slug?: string;
}

export type TemplateId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export const TEMPLATE_NAMES: Record<TemplateId, { name: string; vibe: string }> = {
  1:  { name: "Blanc",     vibe: "White · centered"         },
  2:  { name: "Noir",      vibe: "Black · inverted"         },
  3:  { name: "Écru",      vibe: "Warm · Zodiak accents"    },
  4:  { name: "Ruled",     vibe: "Two rules · structural"   },
  5:  { name: "Masthead",  vibe: "Publication header"       },
  6:  { name: "Big Mark",  vibe: "Oversized quote mark"     },
  7:  { name: "Mono",      vibe: "Typewriter · Geist Mono"  },
  8:  { name: "Broadside", vibe: "Bold · poster impact"     },
  9:  { name: "Letter",    vibe: "Formal · correspondence"  },
  10: { name: "Frame",     vibe: "Inset border · contained" },
};

interface StoryCardProps {
  template: TemplateId;
  data: CardData;
}

export function StoryCard({ template, data }: StoryCardProps) {
  const { quote, title, author, date } = data;

  switch (template) {

    // ── 1. Blanc ────────────────────────────────────────────────────────────
    case 1:
      return (
        <div className="sc-card sc-t1">
          <p className="sc-quote">{quote}</p>
          <hr className="sc-rule" />
          <div className="sc-footer">
            <span className="sc-pub">Verbatim</span>
            <span className="sc-author">&thinsp;·&thinsp;{author}</span>
            <span className="sc-date">&thinsp;·&thinsp;{date}</span>
          </div>
        </div>
      );

    // ── 2. Noir ─────────────────────────────────────────────────────────────
    case 2:
      return (
        <div className="sc-card sc-t2">
          <p className="sc-quote">{quote}</p>
          <hr className="sc-rule" />
          <div className="sc-footer">
            <span className="sc-pub">Verbatim</span>
            <span className="sc-author">&thinsp;·&thinsp;{author}</span>
            <span className="sc-date">&thinsp;·&thinsp;{date}</span>
          </div>
        </div>
      );

    // ── 3. Écru ─────────────────────────────────────────────────────────────
    case 3:
      return (
        <div className="sc-card sc-t3">
          <div className="sc-header">
            <span className="sc-title-text">{title}</span>
            <hr className="sc-rule" />
          </div>
          <p className="sc-quote">{quote}</p>
          <div className="sc-footer">
            <span className="sc-author">{author}</span>
            <span className="sc-date">{date}</span>
          </div>
        </div>
      );

    // ── 4. Ruled ────────────────────────────────────────────────────────────
    case 4:
      return (
        <div className="sc-card sc-t4">
          <hr className="sc-rule" />
          <p className="sc-quote">{quote}</p>
          <hr className="sc-rule" />
          <div className="sc-meta">
            <span className="sc-author">{author}</span>
            <span className="sc-date">{date}</span>
          </div>
        </div>
      );

    // ── 5. Masthead ─────────────────────────────────────────────────────────
    case 5:
      return (
        <div className="sc-card sc-t5">
          <div className="sc-header">
            <span className="sc-pub">Verbatim</span>
            <span className="sc-date">{date}</span>
          </div>
          <hr className="sc-rule" />
          <p className="sc-quote">{quote}</p>
          <span className="sc-author">By {author}</span>
        </div>
      );

    // ── 6. Big Mark ─────────────────────────────────────────────────────────
    case 6:
      return (
        <div className="sc-card sc-t6">
          <span className="sc-mark">&ldquo;</span>
          <p className="sc-quote">{quote}</p>
          <div className="sc-footer">
            <span className="sc-author">{author}</span>
            <span className="sc-date">{date}</span>
          </div>
        </div>
      );

    // ── 7. Mono ─────────────────────────────────────────────────────────────
    case 7:
      return (
        <div className="sc-card sc-t7">
          <div className="sc-header">
            <span className="sc-title-text">{title}</span>
            <hr className="sc-rule" />
          </div>
          <p className="sc-quote">{quote}</p>
          <div className="sc-footer">
            <span className="sc-author">{author}</span>
            <span className="sc-date">{date}</span>
          </div>
        </div>
      );

    // ── 8. Broadside ────────────────────────────────────────────────────────
    case 8:
      return (
        <div className="sc-card sc-t8">
          <p className="sc-quote">{quote}</p>
          <div className="sc-footer">
            <span className="sc-pub">Verbatim</span>
            <span className="sc-date">{date}</span>
          </div>
        </div>
      );

    // ── 9. Letter ───────────────────────────────────────────────────────────
    case 9:
      return (
        <div className="sc-card sc-t9">
          <hr className="sc-rule top" />
          <div className="sc-header">
            <span className="sc-author">{author}</span>
            <span className="sc-title-text">{title}</span>
          </div>
          <p className="sc-quote">{quote}</p>
          <hr className="sc-rule bottom" />
          <span className="sc-date">{date}</span>
        </div>
      );

    // ── 10. Frame ───────────────────────────────────────────────────────────
    case 10:
      return (
        <div className="sc-card sc-t10">
          <div className="sc-inner">
            <p className="sc-quote">{quote}</p>
            <hr className="sc-rule" />
            <div className="sc-meta">
              <span className="sc-author">— {author}</span>
              <span className="sc-date">,&thinsp;{date}</span>
            </div>
          </div>
        </div>
      );
  }
}
