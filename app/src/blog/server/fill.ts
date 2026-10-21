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
