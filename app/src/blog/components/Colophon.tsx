import type { BlogSite } from "@/blog/siteTypes";

export function Colophon({ site }: { site: BlogSite }) {
  return (
    <footer className="blog-colophon">
      <div>© MMXXVI — {site.name}</div>
      <div className="right">
        <a href="mailto:hello@verbatim.example">Email</a>
      </div>
    </footer>
  );
}
