import { currentBlogSite } from "@/blog/site";

export function Colophon() {
  const name = currentBlogSite()?.name ?? "Verbatim";
  return (
    <footer className="blog-colophon">
      <div>© MMXXVI — {name}</div>
      <div className="right">
        <a href="mailto:hello@verbatim.example">Email</a>
      </div>
    </footer>
  );
}
