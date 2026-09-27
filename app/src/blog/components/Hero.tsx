import { useSetting } from "@/lib/settings";
import { currentBlogSite } from "@/blog/site";

interface Props {
  postCount: number;
  collectionCount: number;
  lastUpdate: number | null;
}

const DEFAULT_MANIFESTO =
  "It's called Verbatim because none of it is edited. I don't edit what I write. If I don't like what I said, I don't publish. No AI writing, no nonsense.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(ms: number | null): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, "0");
  return `${day} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function Hero({ postCount, collectionCount, lastUpdate }: Props) {
  // The built-in manifesto and founding year are Verbatim's own; other sites
  // show their manifesto setting, else the author's tagline, else nothing.
  const isVerbatim = currentBlogSite()?.slug === "verbatim";
  const tagline = useSetting<string>("author.tagline", "") ?? "";
  const fallback = isVerbatim ? DEFAULT_MANIFESTO : tagline;
  const manifesto = useSetting<string>("site.manifesto", fallback) ?? fallback;
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
