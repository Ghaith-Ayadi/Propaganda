// /release-notes: every release, newest first, from release-notes/*.md.
// Public, like the blogs: no sign-in.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { loadAppFonts } from "@/lib/appFonts";
import { Page } from "@/components/shell/PageHeader";
import { imageUrl, RELEASE_NOTES } from "./notes";

loadAppFonts();

export function ReleaseNotesPage() {
  return (
    <div className="min-h-dvh bg-primary">
      <Page title="Release notes" description="What changed in each release of Propaganda.">
        <div className="max-w-2xl divide-y divide-secondary">
          {RELEASE_NOTES.map((n) => (
            // Its first line after the title is the date and focus: UI type, not content.
            <article
              key={n.version}
              id={n.version}
              className="py-8 first:pt-0 [&>h2+p]:mt-1 [&>h2+p]:font-body [&>h2+p]:text-sm [&>h2+p]:text-tertiary"
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // The file's "# vX.Y.Z" title.
                  h1: ({ children }) => <h2 className="type-heading text-primary">{children}</h2>,
                  h2: ({ children }) => <h3 className="mt-6 text-sm font-medium text-primary">{children}</h3>,
                  p: ({ children }) => <p className="mt-4 font-serif text-md text-secondary">{children}</p>,
                  ul: ({ children }) => <ul className="mt-4 list-disc space-y-2 pl-5 font-serif text-md text-secondary">{children}</ul>,
                  ol: ({ children }) => <ol className="mt-4 list-decimal space-y-2 pl-5 font-serif text-md text-secondary">{children}</ol>,
                  strong: ({ children }) => <strong className="font-semibold text-primary">{children}</strong>,
                  img: ({ src, alt }) => (
                    <img
                      src={imageUrl(typeof src === "string" ? src : undefined)}
                      alt={alt ?? ""}
                      loading="lazy"
                      className="mt-4 rounded-lg border border-secondary"
                    />
                  ),
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noreferrer" className="text-brand-secondary underline underline-offset-2">
                      {children}
                    </a>
                  ),
                }}
              >
                {n.markdown}
              </ReactMarkdown>
            </article>
          ))}
        </div>
      </Page>
    </div>
  );
}
