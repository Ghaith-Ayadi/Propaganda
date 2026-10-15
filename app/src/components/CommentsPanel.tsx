// The post screen's Comments tab: the post's comments as threads, wired to the
// store (lib/comments) and to the editor's highlights (lib/comments/focus).

import { useMemo } from "react";
import { CommentThreads, type ThreadItem } from "@/components/shared/CommentThreads";
import { activateComment, hoverComment, startComment, useCommentFocus } from "@/lib/comments/focus";
import { addComment, removeComment, setResolved, toThreads, useComments } from "@/lib/comments/store";
import { currentScope } from "@/lib/scope";

export function useOpenCommentCount(postId: string): number {
  return useComments("post", postId).filter((c) => !c.parent && !c.resolved).length;
}

export function CommentsPanel({ postId }: { postId: string }) {
  const comments = useComments("post", postId);
  const focus = useCommentFocus();
  const me = currentScope()?.account.authId ?? "";

  const items: ThreadItem[] = useMemo(
    () =>
      toThreads(comments).map(({ root, replies }) => ({
        id: root.id,
        quote: root.quote,
        lost: !!root.quote && !root.resolved && !focus.found.has(root.id),
        resolved: root.resolved,
        comments: [root, ...replies].map((c) => ({
          id: c.id,
          author: c.authorName,
          at: c.createdAt,
          body: c.body,
          draft: c.submittedAt === null,
          mine: c.authorId === me,
        })),
      })),
    [comments, focus.found, me],
  );

  return (
    <CommentThreads
      threads={items}
      draftQuote={focus.draft?.quote ?? null}
      activeId={focus.active}
      hoverId={focus.hover}
      onActivate={(id) => activateComment(id, "panel")}
      onHover={hoverComment}
      onComment={(body) => {
        const d = focus.draft;
        if (!d) return;
        void addComment({ targetKind: "post", targetId: postId, body, quote: d.quote, contextBefore: d.before, contextAfter: d.after }).then((c) => {
          startComment(null);
          activateComment(c.id, "panel");
        });
      }}
      onCancelDraft={() => startComment(null)}
      onGeneral={(body) => void addComment({ targetKind: "post", targetId: postId, body })}
      onReply={(threadId, body) => void addComment({ targetKind: "post", targetId: postId, body, parent: threadId })}
      onResolve={(id, resolved) => void setResolved(id, resolved)}
      onDelete={(id) => void removeComment(id)}
    />
  );
}
