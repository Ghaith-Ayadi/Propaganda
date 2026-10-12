// /release-notes: every release, newest first, from release-notes/*.md.
// Public, like the blogs: no sign-in.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cx } from "@/utils/cx";
import { imageUrl, RELEASE_NOTES } from "./notes";

export function ReleaseNotesPage() {
  return (
    <div className="min-h-dvh bg-primary">
      <main className="mx-auto w-full max-w-2xl px-4 py-12 md:py-16">
        <header className="mb-10">
          <p className="font-mono text-xs uppercase tracking-wide text-quaternary">Propaganda</p>
          <h1 className="mt-2 text-display-sm font-semibold text-primary">Release notes</h1>
        </header>
        <div className="divide-y divide-secondary">
          {RELEASE_NOTES.map((n) => (
            <article key={n.version} id={n.version} className="py-10 first:pt-0">
              <div
                className={cx(
                  "text-md text-secondary",
                  "[&_h1]:text-display-xs [&_h1]:font-semibold [&_h1]:text-primary",
                  "[&_h1+p]:mt-1 [&_h1+p]:text-sm [&_h1+p]:text-tertiary",
                  "[&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-primary",
                  "[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5",
                  "[&_strong]:font-semibold [&_strong]:text-primary [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm",
                  "[&_img]:mt-4 [&_img]:rounded-lg [&_img]:border [&_img]:border-secondary",
                )}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({ src, alt }) => <img src={imageUrl(typeof src === "string" ? src : undefined)} alt={alt ?? ""} loading="lazy" />,
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noreferrer" className="text-brand-secondary underline underline-offset-2">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {n.markdown}
                </ReactMarkdown>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
