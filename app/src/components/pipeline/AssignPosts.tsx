// Assign posts: a list of posts the person has already decided on goes
// straight to the Writer, with no pitching. One entry per post, separated by a
// blank line: the first line is the title, the rest says what it covers.

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { Edit05 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { NativeSelect } from "@/components/base/select/select-native";
import { toast } from "@/components/base/toast/toast";
import { db } from "@/lib/db";
import { userMessage } from "@/lib/errors";
import { assignPosts } from "@/lib/pipeline/store";
import { reportError, track } from "@/lib/telemetry";
import { TextArea } from "./bits";

const MAX_POSTS = 20;

/** "1. **Title**" or "## Title" down to "Title". */
function cleanTitle(line: string): string {
  return line
    .replace(/^\s*(#{1,6}\s+|[-*]\s+|\d+[.)]\s+)/, "")
    .replace(/\*\*|__/g, "")
    .trim();
}

export function parseAssignments(text: string): { title: string; brief: string }[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").filter((l) => l.trim()))
    .filter((lines) => lines.length)
    .map(([first, ...rest]) => ({ title: cleanTitle(first), brief: rest.map((l) => l.trim()).join("\n") }))
    .filter((p) => p.title);
}

export function AssignButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" color="secondary" iconLeading={Edit05} onClick={() => setOpen(true)}>
        Assign posts
      </Button>
      {open && <AssignDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function AssignDialog({ onClose }: { onClose: () => void }) {
  const collections = useLiveQuery(() => db.collections.orderBy("position").toArray(), [], []);
  const [collection, setCollection] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const posts = useMemo(() => parseAssignments(text), [text]);
  const target = collection || collections[0]?.name || "";
  const tooMany = posts.length > MAX_POSTS;

  const assign = async () => {
    setBusy(true);
    try {
      const { made, notStarted } = await assignPosts(posts, target);
      track("posts_assigned", { posts: made });
      toast.add({
        type: notStarted.length ? "warning" : "success",
        title: `${made} ${made === 1 ? "post is" : "posts are"} with us, in ${target}.`,
        description: notStarted.length ? `Not started: ${notStarted.join("; ")}` : "Each draft shows up in Writing when it's ready.",
      });
      onClose();
    } catch (err) {
      reportError("pipeline.assignPosts", err);
      toast.add({ type: "error", title: userMessage(err) });
      setBusy(false);
    }
  };

  return (
    <ModalOverlay
      isOpen
      isDismissable={!busy}
      onOpenChange={(o) => !o && onClose()}
      className="fixed inset-0 z-50 bg-overlay/40 duration-150 entering:animate-in entering:fade-in exiting:animate-out exiting:fade-out"
    >
      <Modal className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog aria-label="Assign posts" className="flex max-h-full w-full max-w-[720px] flex-col rounded-2xl bg-primary shadow-xl outline-hidden">
          <header className="flex items-start justify-between gap-3 border-b border-secondary px-6 pt-5 pb-4">
            <div>
              <h2 className="type-title text-primary">Assign posts</h2>
              <p className="mt-1 text-sm text-tertiary">
                Posts you've already decided on. They skip the pitches and go straight to writing, and we follow the collection's rules.
              </p>
            </div>
            <CloseButton size="md" onPress={onClose} label="Close" className="-mr-2 shrink-0" />
          </header>
          <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
            <NativeSelect
              label="Collection"
              size="md"
              options={collections.map((c) => ({ label: c.name, value: c.name }))}
              value={target}
              onChange={(e) => setCollection(e.target.value)}
            />
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-secondary">The posts</span>
              <TextArea
                rows={12}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"One post per paragraph. The first line is the title, the rest says what it covers.\n\nBlind tests for an AI strategist\nGive a second model only the inputs and compare its plan to the agent's. Method, results, what we learned."}
              />
              <span className={tooMany ? "text-sm text-error-primary" : "text-sm text-tertiary"}>
                {tooMany ? `${posts.length} posts. Assign at most ${MAX_POSTS} at a time.` : `${posts.length} ${posts.length === 1 ? "post" : "posts"}`}
              </span>
            </label>
            {posts.length > 0 && !tooMany && (
              <ol className="flex flex-col gap-1 text-sm text-secondary">
                {posts.map((p, n) => (
                  <li key={n} className="truncate">
                    {n + 1}. {p.title}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <footer className="flex justify-end gap-2 border-t border-secondary px-6 py-4">
            <Button size="md" color="tertiary" isDisabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button size="md" color="primary" isLoading={busy} isDisabled={!posts.length || tooMany || !target} onClick={() => void assign()}>
              {posts.length > 1 ? `Assign ${posts.length} posts` : "Assign"}
            </Button>
          </footer>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
