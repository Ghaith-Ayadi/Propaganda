import { useSetting } from "@/lib/settings";

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
  const manifesto = useSetting<string>("site.manifesto", DEFAULT_MANIFESTO) ?? DEFAULT_MANIFESTO;
  return (
    <section className="blog-hero">
      <p className="manifesto">{manifesto}</p>
      <div className="meta">
        <span>
          <b>{postCount}</b> posts
        </span>
        <span>
          <b>{collectionCount}</b> collections
        </span>
        <span>
          Est. <b>MMXXII</b>
        </span>
        {lastUpdate && (
          <span>
            Last update <b>{fmtDate(lastUpdate)}</b>
          </span>
        )}
      </div>
    </section>
  );
}
