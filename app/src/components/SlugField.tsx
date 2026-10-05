// The post's address on its blog, /<collection slug>/<post slug>. Until the
// post is first published the slug follows the title and can't be edited here;
// after, it can, and every old address keeps working as a redirect (the server
// writes it), listed under the field.

import { useEffect, useState } from "react";
import { XClose } from "@untitledui/icons";
import { Input } from "@/components/base/input/input";
import { toast } from "@/components/base/toast/toast";
import { useWorkspace } from "@/components/Workspace";
import { db } from "@/lib/db";
import { must, sb } from "@/lib/supabase";
import { updatePost } from "@/lib/posts";
import { postPublicUrl, readableUrl } from "@/lib/siteUrl";
import { collectionSlugOf, hasAddress, postPath, slugify } from "@/lib/slug";
import { flushSync } from "@/lib/sync";
import type { Collection, Post } from "@/types";

interface Redirect {
  id: string;
  collection: string;
  slug: string;
}

export function SlugField({ post, collections }: { post: Post; collections: Collection[] }) {
  const { site } = useWorkspace();
  const collection = collectionSlugOf(post.type, collections);
  const url = postPublicUrl(site, collection, post.slug);
  const fixed = hasAddress(post);
  const [draft, setDraft] = useState(post.slug);
  const [error, setError] = useState<string | null>(null);
  const [redirects, setRedirects] = useState<Redirect[]>([]);

  useEffect(() => {
    setDraft(post.slug);
    setError(null);
  }, [post.id, post.slug]);

  // Its old addresses, as the server keeps them. Fetched again after each push
  // (syncedAt), since that's when a new one appears. Offline: nothing to show.
  useEffect(() => {
    if (!fixed) {
      setRedirects([]);
      return;
    }
    let live = true;
    void must(sb.from("post_redirects").select("id,collection,slug").eq("post", post.id).order("created", { ascending: false }))
      .then((rows) => live && setRedirects(rows as Redirect[]))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [post.id, fixed, post.syncedAt]);

  // Saved on blur or Enter, never per keystroke: each save of a published post's
  // slug leaves a redirect behind.
  async function commit() {
    const next = slugify(draft);
    if (!next || next === post.slug) {
      setDraft(post.slug);
      setError(null);
      return;
    }
    const clash = await db.posts
      .where("type")
      .equals(post.type)
      .filter((p) => p.id !== post.id && hasAddress(p) && p.slug === next)
      .first();
    if (clash) {
      setError(`"${clash.title || "Untitled"}" already has this address.`);
      return;
    }
    setError(null);
    setDraft(next);
    await updatePost(post.id, { slug: next });
    // The server has the last word (an old address of another post counts as taken).
    await flushSync();
    const after = await db.posts.get(post.id);
    if (after && after.slug !== next && !after.dirty) {
      toast.add({
        type: "info",
        title: "Address adjusted",
        description: `${postPath(collection, next)} was taken, so it's ${postPath(collection, after.slug)}.`,
      });
    }
  }

  async function removeRedirect(r: Redirect) {
    try {
      await must(sb.from("post_redirects").delete().eq("id", r.id));
      setRedirects((xs) => xs.filter((x) => x.id !== r.id));
    } catch {
      toast.add({ type: "error", title: "Couldn't remove the redirect", description: "Check your connection and try again." });
    }
  }

  return (
    <div>
      <Input
        size="sm"
        aria-label="Slug"
        value={fixed ? draft : post.slug}
        isDisabled={!fixed}
        isInvalid={Boolean(error)}
        onChange={setDraft}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          const input = e.target as HTMLInputElement;
          if (e.key === "Enter") input.blur();
          if (e.key === "Escape") {
            setDraft(post.slug);
            setError(null);
            input.blur();
          }
        }}
      />
      {error && <p className="mt-1.5 text-[11px] text-error-primary">{error}</p>}
      <p className="mt-1.5 select-all truncate text-[11px] text-quaternary">{readableUrl(url)}</p>
      {!fixed && <p className="mt-1 text-[11px] text-quaternary">Follows the title until you publish.</p>}
      {redirects.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-medium text-tertiary">Redirects here</div>
          <ul className="space-y-0.5">
            {redirects.map((r) => {
              const from = postPath(r.collection, r.slug);
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 text-[11px] text-quaternary">
                  <span className="truncate font-mono">{from}</span>
                  <button
                    type="button"
                    aria-label={`Stop redirecting ${from}`}
                    title="Stop redirecting"
                    onClick={() => void removeRedirect(r)}
                    className="shrink-0 rounded p-0.5 opacity-60 transition hover:bg-tertiary hover:opacity-100"
                  >
                    <XClose className="size-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
