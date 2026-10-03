import { currentBlogSite } from "@/blog/site";

// Every blog links back to Propaganda: links from many sites count for
// propaganda.pub, custom domains included. The wordmark is the marketing
// site's logo.svg (it plays its glitch once as it loads), copied to
// public/brand/ and lazy, so it only loads when the footer comes into view.
export function Colophon() {
  const site = currentBlogSite();
  const name = site?.name ?? "Verbatim";
  const ref = site ? `?ref=${encodeURIComponent(site.slug)}` : "";
  return (
    <footer className="blog-colophon">
      <div>© MMXXVI — {name}</div>
      <div className="right">
        <a href="mailto:hello@verbatim.example">Email</a>
        <a className="published-with" href={`https://propaganda.pub/${ref}`}>
          Published with
          <img src="/brand/propaganda-logo.svg" alt="Propaganda" width={67} height={16} loading="lazy" decoding="async" />
        </a>
      </div>
    </footer>
  );
}
