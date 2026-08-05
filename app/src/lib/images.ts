// Image-block helpers.
//
// BlockNote inserts a *file* block (not an *image* block) when you paste or drop
// an image file. A file block serialises to Markdown as a link — `[name](url)` —
// so it renders as a document card instead of the picture, and on reload parses
// back to a plain link. These helpers normalise that: on load we promote
// image-URL file blocks (and standalone image-URL links) to real image blocks,
// and on edit we promote freshly pasted/dropped image files in place.

// Matches a URL/filename ending in a known image extension (query/hash ignored).
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i;

export function isImageUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  return IMAGE_EXT.test(s.trim());
}

// Minimal shape we care about — avoids coupling to BlockNote's generic types.
interface LooseInline {
  type?: string;
  text?: string;
  href?: string;
  content?: LooseInline[];
}
interface LooseBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: LooseInline[] | unknown;
}

function imageBlock(url: string, name: string, caption = ""): LooseBlock {
  return { type: "image", props: { url, name, caption, showPreview: true } };
}

/**
 * Rewrite parsed blocks so image content displays as images:
 *  - a `file` block whose url/name is an image → `image` block
 *  - a paragraph whose only content is a single link to an image → `image` block
 *    (this is how the legacy `[name](url)` serialisation parses back)
 * Everything else passes through untouched. Pure — returns new blocks.
 */
export function normalizeImageBlocks<T extends LooseBlock>(blocks: T[]): LooseBlock[] {
  return blocks.map((b) => {
    if (b?.type === "file") {
      const url = (b.props?.url as string) ?? "";
      const name = (b.props?.name as string) ?? "";
      if (isImageUrl(url) || isImageUrl(name)) {
        return imageBlock(url, name, (b.props?.caption as string) ?? "");
      }
    }
    if (b?.type === "paragraph" && Array.isArray(b.content)) {
      const meaningful = (b.content as LooseInline[]).filter(
        (c) => !(c?.type === "text" && !c.text?.trim()),
      );
      const only = meaningful[0];
      if (meaningful.length === 1 && only?.type === "link" && isImageUrl(only.href)) {
        const name = (only.content ?? []).map((t) => t?.text ?? "").join("");
        return imageBlock(only.href ?? "", name);
      }
    }
    return b;
  });
}

// Loosely typed to sidestep BlockNote's heavily-generic editor type; we only
// touch `document` and `updateBlock`.
interface EditorLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  document: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateBlock: (block: any, update: any) => unknown;
}

/** True if the live document has any image-URL file block awaiting promotion. */
export function hasImageFileBlock(editor: EditorLike): boolean {
  return editor.document.some(
    (b: LooseBlock) =>
      b?.type === "file" &&
      (isImageUrl(b.props?.url as string) || isImageUrl(b.props?.name as string)),
  );
}

/** Promote every image-URL file block in the live document to an image block. */
export function promoteImageFileBlocks(editor: EditorLike): boolean {
  let changed = false;
  for (const b of editor.document as LooseBlock[]) {
    if (
      b?.type === "file" &&
      (isImageUrl(b.props?.url as string) || isImageUrl(b.props?.name as string))
    ) {
      editor.updateBlock(b, {
        type: "image",
        props: {
          url: (b.props?.url as string) ?? "",
          name: (b.props?.name as string) ?? "",
          caption: (b.props?.caption as string) ?? "",
          showPreview: true,
        },
      });
      changed = true;
    }
  }
  return changed;
}
