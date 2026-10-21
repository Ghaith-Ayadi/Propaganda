// Puts a rendered page into the app's built shell (dist/index.html). Pure, so
// it can be tested without the build: page.tsx passes the shell in.
//
// Every value is spliced with a function replacer: a title or a post with
// `$&`, `$'` or `$$` in it must land as written, never as what
// String.prototype.replace makes of those patterns.

export interface FillOptions {
  /** Head tags, already escaped (title, description, canonical, OG, ...). */
  head: string;
  /** Stylesheets to inline, in order. */
  css: string[];
  /** Attributes to add to <html>, already escaped. */
  htmlAttrs?: string;
  /** The page's markup, from renderToString. */
  markup: string;
  /** An escaped favicon URL, replacing the shell's. */
  favicon?: string | null;
}

const once = (value: string) => () => value;

export function fillShell(shell: string, opts: FillOptions): string {
  let out = shell;
  if (opts.htmlAttrs) out = out.replace(/<html lang="en">/, once(`<html lang="en" ${opts.htmlAttrs}>`));
  if (opts.favicon) out = out.replace(/<link rel="icon"[^>]*>/, once(`<link rel="icon" href="${opts.favicon}">`));
  const styles = opts.css.map((c) => `<style>${c}</style>`).join("\n    ");
  out = out.replace(/<title>[^<]*<\/title>/, once(`${opts.head}\n    ${styles}`));
  out = out.replace('<div id="root"></div>', once(`<div id="pg-ssr">${opts.markup}</div>\n    <div id="root"></div>`));
  return out;
}

/* ---------------------------------------------------- fragments (the box) */
//
// The box (box.ts) stores a page as a fragment, nothing from the app build in
// it, and Caddy wraps it in the current shell when a reader asks (Bedrock's
// compose/blog/wrap.html, a Caddy template). The shell is kept as pieces, the
// fragment as the fillers between them, so the template only concatenates:
//
//   piece 0 · attrs · piece 1 · favicon tag (or the shell's) · piece 2 · head
//   and styles · piece 3 · <div id="pg-ssr"> markup </div> · piece 4
//
// wrap() is the same join in TypeScript; the test checks it against fillShell.

/** Between the parts of a fragment. Never in HTML: a comment, on its own line. */
export const FRAGMENT_SEPARATOR = "\n<!--pg-->\n";

export interface ShellPieces {
  /** Up to and including `<html lang="en"`. */
  pieces: [string, string, string, string, string];
  /** The shell's own favicon tag, when a page sets none. */
  favicon: string;
}

/** The built shell cut where a page's parts go. Throws when the shell is not the app's. */
export function shellPieces(shell: string): ShellPieces {
  const html = shell.indexOf('<html lang="en">');
  const icon = shell.match(/<link rel="icon"[^>]*>/);
  const title = shell.match(/<title>[^<]*<\/title>/);
  const root = shell.indexOf('<div id="root"></div>');
  if (html < 0 || !icon || icon.index == null || !title || title.index == null || root < 0) throw new Error("not the app's shell");
  const htmlEnd = html + '<html lang="en"'.length;
  return {
    pieces: [
      shell.slice(0, htmlEnd),
      shell.slice(htmlEnd, icon.index),
      shell.slice(icon.index + icon[0].length, title.index),
      shell.slice(title.index + title[0].length, root),
      shell.slice(root),
    ],
    favicon: icon[0],
  };
}

/** A page's parts as one file. */
export function fragmentOf(opts: FillOptions): string {
  const styles = opts.css.map((c) => `<style>${c}</style>`).join("\n    ");
  return [
    opts.htmlAttrs ? ` ${opts.htmlAttrs}` : "",
    opts.favicon ? `<link rel="icon" href="${opts.favicon}">` : "",
    `${opts.head}\n    ${styles}`,
    opts.markup,
  ].join(FRAGMENT_SEPARATOR);
}

/** The page Caddy's template makes of a fragment: the same as fillShell. */
export function wrap(shell: ShellPieces, fragment: string): string {
  const [attrs, favicon, head, markup] = fragment.split(FRAGMENT_SEPARATOR);
  const [p0, p1, p2, p3, p4] = shell.pieces;
  return `${p0}${attrs}${p1}${favicon || shell.favicon}${p2}${head}${p3}<div id="pg-ssr">${markup}</div>\n    ${p4}`;
}
