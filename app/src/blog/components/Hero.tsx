import type { BlogSite } from "@/blog/siteTypes";

interface Props {
  site: BlogSite;
  /** Resolved by the caller (blog/original.ts): the site's manifesto, else the author's tagline, else nothing. */
  manifesto: string;
  postCount: number;
  collectionCount: number;
  lastUpdate: number | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(ms: number | null): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, "0");
  return `${day} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function Hero({ site, manifesto, postCount, collectionCount, lastUpdate }: Props) {
  // The founding year is Verbatim's own.
  const isVerbatim = site.slug === "verbatim";
  return (
    <section className="blog-hero">
      {manifesto && <p className="manifesto">{manifesto}</p>}
      <div className="meta">
        <span>
          <b>{postCount}</b> posts
        </span>
        <span>
          <b>{collectionCount}</b> collections
        </span>
        {isVerbatim && (
          <span>
            Est. <b>MMXXII</b>
          </span>
        )}
        {lastUpdate && (
          <span>
            Last update <b>{fmtDate(lastUpdate)}</b>
          </span>
        )}
      </div>
    </section>
  );
}
