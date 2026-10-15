// "Comment" in the selection toolbar: takes the highlighted words, with a few
// words either side to find them again, and hands them to the Comments tab.

import { MessageSquare01 } from "@untitledui/icons";
import { useBlockNoteEditor, useComponentsContext } from "@blocknote/react";
import { startComment } from "@/lib/comments/focus";
import { contextAround } from "@/lib/comments/store";
import { useIsMobile, setDrawer } from "@/lib/mobile";
import { useLayout } from "@/lib/layout";

export function CommentToolbarButton() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;
  const isMobile = useIsMobile();
  const [, setLayout] = useLayout();

  function comment() {
    const { selection, doc } = editor.prosemirrorState;
    if (selection.from === selection.to) return;
    const quote = doc.textBetween(selection.from, selection.to, " ").trim();
    if (!quote) return;
    const block = doc.resolve(selection.from).parent;
    const text = block.textContent;
    const start = doc.resolve(selection.from).parentOffset;
    const { before, after } = contextAround(text, start, start + (selection.to - selection.from));
    startComment({ quote, before, after });
    if (isMobile) setDrawer("attributes");
    else setLayout({ attributes: true });
  }

  return (
    <Components.FormattingToolbar.Button
      label="Comment"
      mainTooltip="Comment on this text"
      icon={<MessageSquare01 size={16} />}
      onClick={comment}
    />
  );
}
